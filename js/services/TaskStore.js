import { Task, PALETTE } from '../models/Task.js';
import { _getSoonestDueDate } from '../utils.js';
import { UndoHistory } from './store/UndoHistory.js';
import { LocalSaver } from './store/LocalSaver.js';
import { DriveSync } from './store/DriveSync.js';
import { CalendarSync } from './store/CalendarSync.js';

// TaskStore owns the app's data (tasks, completion log, whiteboard, settings) and is the
// one object the rest of the app talks to; undo, saving and calendar sync are delegated.
export class TaskStore {
  constructor() {
    const saved = LocalSaver.load();
    this.tasks = saved.tasks;
    this.completionLog = saved.completionLog;
    this.calendarSyncEnabled = saved.calendarSyncEnabled;
    this.whiteboard = saved.whiteboard; // [{ id, kind: 'category'|'task'|'subtask', text, added }]
    this.listeners = [];

    this.history = new UndoHistory(() => this._serialize());
    this.sync = new DriveSync({
      snapshot: () => LocalSaver.toJSON(this),
      hasData: () => this.tasks.length > 0,
      apply: (data) => this._applyDriveData(data),
    });
    this.calendar = new CalendarSync(this);
  }

  // ---------- subscriptions ----------
  subscribe(fn) { this.listeners.push(fn); }
  onSyncStatus(fn) { this.sync.onStatus(fn); }
  onHistory(fn) { this.history.onChange(fn); }

  _notify() { this.listeners.forEach((fn) => fn()); }

  // ---------- settings ----------
  getCalendarSyncEnabled() {
    return this.calendarSyncEnabled !== false; // default true
  }

  setCalendarSyncEnabled(enabled) {
    this.calendarSyncEnabled = enabled;
    this.save();
  }

  // ---------- queries ----------
  getAll() { return this.tasks; }
  find(id) { return this.tasks.find((t) => t.id === id); }
  getCompletionLog() { return this.completionLog; }
  getWhiteboard() { return this.whiteboard; }

  // Done tasks last, then by soonest due date (stable sort keeps the first ordering on ties).
  getSorted() {
    const isTaskDone = (t) => t.subtasks.length > 0 && t.subtasks.every((s) => s.done);

    const sorted = [...this.tasks].sort((a, b) => isTaskDone(a) - isTaskDone(b));
    return sorted.sort((a, b) => {
      const aDue = _getSoonestDueDate(a);
      const bDue = _getSoonestDueDate(b);
      if (aDue && bDue) return aDue - bDue;
      if (aDue) return -1;
      if (bDue) return 1;
      return 0;
    });
  }

  countBlocksWithoutEvents() { return this.calendar.countBlocksWithoutEvents(); }
  countBlocksWithEvents() { return this.calendar.countBlocksWithEvents(); }

  _findSubtask(taskId, subIndex) {
    return this.find(taskId)?.subtasks[subIndex];
  }

  // ---------- task mutations ----------
  add(task) {
    this.tasks.push(task);
    this.save();
  }

  async update(id, { name, subtasks }, googleCalendar) {
    const t = this.find(id);
    if (!t) return;

    const taskNameChanged = t.name !== name;
    const renamedSubtasks = [];

    subtasks.forEach((ns) => {
      const old = t.subtasks.find((o) => o.id === ns.id);
      if (!old) return;
      if (old.blocks.length) ns.blocks = old.blocks;
      ns.done = old.done;
      ns.actualHours = old.actualHours;
      ns.note = old.note;
      ns.waiting = old.waiting;
      if (old.name !== ns.name) {
        renamedSubtasks.push({ subtask: ns, oldName: old.name, newName: ns.name });
      }
    });

    t.name = name;
    t.subtasks = subtasks;
    this.save();

    if (googleCalendar && googleCalendar.isAuthed) {
      await this.calendar.updateEventTitles(t, taskNameChanged, renamedSubtasks, googleCalendar);
    }
  }

  async removeTask(id, scope, googleCalendar) {
    const t = this.find(id);
    if (!t) return;
    if (scope && scope !== 'none') {
      for (const st of t.subtasks) {
        await this.deleteSubtaskEvents(st, scope, googleCalendar);
      }
    }
    this.tasks = this.tasks.filter((x) => x.id !== id);
    this.save();
  }

  // 'always' tasks stay on the list even when every subtask is done
  setPersistent(taskId, persistent) {
    const t = this.find(taskId);
    if (!t) return;
    t.persistent = persistent;
    this.save();
  }

  // Add subtasks after the existing ones; returns the index of the first new one.
  appendSubtasks(taskId, subtasks) {
    const t = this.find(taskId);
    if (!t) return -1;
    const startIndex = t.subtasks.length;
    t.subtasks.push(...subtasks);
    this.save();
    return startIndex;
  }

  setTaskNote(taskId, note) {
    const t = this.find(taskId);
    if (!t) return;
    t.note = note;
    this.save();
  }

  // ---------- subtask mutations ----------
  setSubtaskBlocks(taskId, subIndex, blocks) {
    const t = this.find(taskId);
    if (!t) return;
    t.subtasks[subIndex].blocks = blocks;
    this.save();
  }

  addBlockToSubtask(taskId, subIndex, block) {
    const st = this._findSubtask(taskId, subIndex);
    if (!st) return;
    st.blocks.push(block);
    this.save();
  }

  async completeSubtask(taskId, subIndex, actualHours, scope, googleCalendar) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    await this.deleteSubtaskEvents(st, scope, googleCalendar);
    st.done = true;
    st.actualHours = actualHours;
    this.save();
  }

  uncompleteSubtask(taskId, subIndex) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    st.done = false;
    st.actualHours = null;
    st.blocks = st.blocks.filter((b) => b.eventId !== null);
    this.save();
  }

  toggleWaiting(taskId, subIndex) {
    const st = this._findSubtask(taskId, subIndex);
    if (!st) return;
    st.waiting = !st.waiting;
    this.save();
  }

  setSubtaskNote(taskId, subIndex, note) {
    const st = this._findSubtask(taskId, subIndex);
    if (!st) return;
    st.note = note;
    this.save();
  }

  // ---------- completion log ----------
  // One entry per subtask; re-completing replaces the earlier entry.
  logCompletion({ taskName, subtaskName, subtaskId, hoursSpent, taskId, taskJustCompleted }) {
    const entry = {
      subtaskId,
      taskId,
      taskName,
      subtaskName,
      hoursSpent,
      taskJustCompleted: !!taskJustCompleted, // was this the last subtask?
      completedAt: new Date().toISOString(),
    };

    const existingIdx = this.completionLog.findIndex((e) => e.subtaskId === subtaskId);
    if (existingIdx >= 0) this.completionLog[existingIdx] = entry;
    else this.completionLog.push(entry);

    this.save();
  }

  // Move a completed item to the day you actually did it (keeps its time of day).
  // ymd = 'YYYY-MM-DD' (local). Undoable like any other change.
  moveCompletion(index, ymd) {
    const e = this.completionLog[index];
    if (!e || !ymd) return;
    const old = new Date(e.completedAt);
    const [y, m, d] = ymd.split('-').map(Number);
    const moved = new Date(y, m - 1, d, old.getHours(), old.getMinutes(), old.getSeconds());
    e.completedAt = moved.toISOString();
    this.save();
  }

  // ---------- whiteboard (quick-capture list) ----------
  setWhiteboard(lines) {
    this.whiteboard = lines;
    this.save();
  }

  saveWhiteboard(opts) { this.save(opts); }

  // ---------- Google Calendar (see CalendarSync) ----------
  deleteSubtaskEvents(st, scope, googleCalendar) {
    return this.calendar.deleteSubtaskEvents(st, scope, googleCalendar);
  }

  pushUnsyncedBlocks(googleCalendar, onProgress = null) {
    return this.calendar.pushUnsyncedBlocks(googleCalendar, onProgress);
  }

  deleteAllCalendarEvents(googleCalendar, onProgress = null) {
    return this.calendar.deleteAllCalendarEvents(googleCalendar, onProgress);
  }

  reconcileWithCalendar(googleCalendar) {
    return this.calendar.reconcile(googleCalendar);
  }

  // ---------- undo / redo (see UndoHistory) ----------
  canUndo() { return this.history.canUndo(); }
  canRedo() { return this.history.canRedo(); }

  undo() { return this._restore(this.history.stepBack()); }
  redo() { return this._restore(this.history.stepForward()); }

  // undo snapshot shape: tasks + completion log + whiteboard
  _serialize() {
    return JSON.stringify({
      tasks: this.tasks.map((t) => t.toJSON()),
      completionLog: this.completionLog,
      whiteboard: this.whiteboard,
    });
  }

  // Put a snapshot back without recording it as a new undo step. False if there was none.
  _restore(json) {
    if (json === null) return false;
    const d = JSON.parse(json);
    this.tasks = (d.tasks || []).map((t) => new Task(t));
    this.completionLog = d.completionLog || [];
    this.whiteboard = d.whiteboard || [];
    this.history.markRestored(json);
    this._persist();
    this.history.emit();
    return true;
  }

  // ---------- persistence (see LocalSaver, DriveSync) ----------
  // Every change ends here: undo step → localStorage → notify views → debounced Drive save.
  // opts: { history: false } to skip undo; { coalesce: key } to merge with the previous step
  save(opts) {
    this.history.record(opts);
    this._persist();
  }

  _persist() {
    this._saveLocal();
    this._notify();
    this.sync.scheduleSave();
  }

  _saveLocal() { LocalSaver.save(this); }

  // Drive save state: 'synced' | 'saving' | 'failed' | 'offline'
  get syncStatus() { return this.sync.status; }
  // save to Drive right away (after a failure or coming back online)
  retrySave() { return this.sync.saveNow(); }

  attachDrive(drive) { this.sync.attach(drive); }

  // Called after Google connects: last-write-wins, so Drive wins on load.
  loadFromDrive() { return this.sync.load(); }

  _applyDriveData({ tasks, completionLog, calendarSyncEnabled, whiteboard }) {
    if (calendarSyncEnabled !== undefined) this.calendarSyncEnabled = calendarSyncEnabled;
    if (whiteboard) this.whiteboard = whiteboard;
    this.tasks = tasks.map((t) => new Task(t));
    this.completionLog = completionLog;
    this._assignPaletteColors();
    this._saveLocal();
    this.history.reset(); // fresh data from Drive → fresh undo history
    this._notify();
  }

  _assignPaletteColors() {
    this.tasks.forEach((t, i) => { t.color = PALETTE[i % PALETTE.length]; });
  }
}
