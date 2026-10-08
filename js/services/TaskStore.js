import { Task, PALETTE } from '../models/Task.js';
import {_getSoonestDueDate } from '../utils.js';

const STORAGE_KEY = 'taskGrid';

export class TaskStore {
  constructor() {
    this.completionLog = []; 
    this.calendarSyncEnabled = true;       
    this.tasks = this._loadLocal();
    this.listeners = [];
    this.used_colors = [];
    this.drive = null;
    this.syncStatusFn = () => {};
    this._saveTimer = null;
  }

  getCalendarSyncEnabled() {
    return this.calendarSyncEnabled !== false; // default true
  }

  setCalendarSyncEnabled(enabled) {
    this.calendarSyncEnabled = enabled;
    this._save();
  }

  // ---------- Drive wiring ----------
  attachDrive(drive) {
    this.drive = drive;
  }

  onSyncStatus(fn) {
    this.syncStatusFn = fn;
  }

  // Check all incomplete subtasks' blocks against Google Calendar.
  // Removes deleted events, updates moved/resized ones.
  async reconcileWithCalendar(googleCalendar) {
    if (!googleCalendar || !googleCalendar.isAuthed) return false;

    // Collect the date range of all blocks
    let minDate = null, maxDate = null;
    const allEventIds = new Set();
    for (const task of this.tasks) {
      for (const st of task.subtasks) {
        for (const b of st.blocks) {
          if (b.eventId) allEventIds.add(b.eventId);
          if (b.date) {
            const d = new Date(b.date + 'T00:00:00');
            if (!minDate || d < minDate) minDate = d;
            if (!maxDate || d > maxDate) maxDate = d;
          }
        }
      }
    }

    if (!minDate) return false; // no blocks

    // widen range a bit
    minDate.setDate(minDate.getDate() - 1);
    maxDate.setDate(maxDate.getDate() + 2);

    // ONE batch fetch instead of per-block
    let events;
    try {
      events = await googleCalendar.getEvents(minDate, maxDate, ['primary']);
    } catch (e) {
      console.warn('Reconcile batch fetch failed', e);
      return false;
    }

    // build a lookup: eventId → event
    const eventMap = new Map();
    events.forEach((ev) => eventMap.set(ev.id, ev));

    let changed = false;

    for (const task of this.tasks) {
      for (const st of task.subtasks) {
        const keptBlocks = [];
        for (const b of st.blocks) {
          // No eventId → app-only block → just keep it (don't delete!)
          if (!b.eventId) {
            keptBlocks.push(b);   // ← CHANGED: keep app-only blocks
            continue;
          }

          let real;
          try {
            real = await googleCalendar.getEventById(b.eventId);
          } catch (e) {
            keptBlocks.push(b); // network error → keep
            continue;
          }

          if (real === null) {
            // event gone → clear eventId, KEEP block
            b.eventId = null;
            changed = true;
            keptBlocks.push(b);   // ← CHANGED: keep the block
            continue;
          }

          // event exists → sync time (for incomplete subtasks)
          if (!st.done) {
            const newDate = this._ymdLocal(real.start);
            const newStart = this._hhmm(real.start);
            const newHours = (real.end - real.start) / 3600000;
            if (b.date !== newDate || b.start !== newStart ||
                Math.abs(b.hoursNum - newHours) > 0.001) {
              b.date = newDate;
              b.start = newStart;
              b.hours = Math.round(newHours * 100) / 100;
              changed = true;
            }
          }

          // (description → note sync, if you have Chunk 3)
          const eventDesc = real.description || '';
          if (eventDesc !== (st.note || '')) {
            st.note = eventDesc;
            changed = true;
          }

          keptBlocks.push(b);
        }

        st.blocks = keptBlocks;
      }
    }

    if (changed) this._save();
    return changed;
  }

  // local-time YYYY-MM-DD (avoid UTC shift)
  _ymdLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  _hhmm(d) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // Called after Google connects: pull from Drive (last-write-wins = Drive wins on load)
  async loadFromDrive() {
    if (!this.drive) { this._setStatus('offline'); return; }
    this._setStatus('saving');
    const remote = await this.drive.load();

    if (remote) {
      let taskArray, log;
      if (Array.isArray(remote)) {
        taskArray = remote; log = [];
      } else if (remote && typeof remote === 'object') {
        taskArray = remote.tasks || []; 
        log = remote.completionLog || [];
        this.calendarSyncEnabled = remote.calendarSyncEnabled !== false;
      } else {
        this._setStatus('synced'); return;
      }
      this.tasks = taskArray.map((t) => new Task(t));
      this.completionLog = log;

      let colorIndex = 0;
      this.used_colors = [];
      for (const t of this.tasks) {
        t.color = PALETTE[colorIndex % PALETTE.length];
        this.used_colors.push(t.color);
        colorIndex++;
      }
      this._saveLocal();
      this._notify();
      this._setStatus('synced');
    } else {
      if (this.tasks.length > 0) await this._saveRemote();
      else this._setStatus('synced');
    }
  }

  // ---------- persistence ----------
  _loadLocal() {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw) { this.completionLog = []; return []; }
    if (Array.isArray(raw)) { this.completionLog = []; return raw.map((t) => new Task(t)); }
    this.completionLog = raw.completionLog || [];
    this.calendarSyncEnabled = raw.calendarSyncEnabled !== false;
    return (raw.tasks || []).map((t) => new Task(t));
  }

  _saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tasks: this.tasks.map((t) => t.toJSON()),
      completionLog: this.completionLog,
      calendarSyncEnabled: this.calendarSyncEnabled,
    }));
  }

  async _saveRemote() {
    if (!this.drive || !this.drive.isReady) { this._setStatus('offline'); return; }
    this._setStatus('saving');
    const ok = await this.drive.save({
      tasks: this.tasks.map((t) => t.toJSON()),
      completionLog: this.completionLog,
      calendarSyncEnabled: this.calendarSyncEnabled,
    });
    this._setStatus(ok ? 'synced' : 'failed');
  }

  addBlockToSubtask(taskId, subIndex, block) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    if (!st) return;
    st.blocks.push(block);
    this._save();
  }

  _setStatus(status) {
    this._status = status;
    this.syncStatusFn(status);
  }

  // Save locally immediately, debounce the Drive save
  _save() {
    this._saveLocal();
        this._notify();

        // immediately show we have unsaved changes
        if (this.drive && this.drive.isReady) {
        this._setStatus('saving');
        }

        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveRemote(), 800);
    }

  // ---------- subscriptions ----------
  subscribe(fn) { this.listeners.push(fn); }
  _notify() { this.listeners.forEach((fn) => fn()); }

  // ---------- queries ----------
  getAll() { return this.tasks; }
  find(id) { return this.tasks.find((t) => t.id === id); }

  getSorted() {
    const isTaskDone = (t) =>
      t.subtasks.length > 0 && t.subtasks.every((s) => s.done);
    const soonestDueDate = (t) => {
      return _getSoonestDueDate(t);
    };

    const sorted = [...this.tasks].sort(
      (a, b) => (isTaskDone(a) ? 1 : 0) - (isTaskDone(b) ? 1 : 0)
    );``
    return sorted.sort((a, b) => {
      const aDue = soonestDueDate(a);
      const bDue = soonestDueDate(b);
      if (aDue && bDue) return aDue - bDue;
      if (aDue) return -1;
      if (bDue) return 1;
      return 0;
    });
  }

  // Count blocks that have NO calendar event (need pushing)
  countBlocksWithoutEvents() {
    let count = 0;
    this.tasks.forEach((t) =>
      t.subtasks.forEach((st) => {
        if (st.done) return; // skip completed subtasks
        st.blocks.forEach((b) => { if (!b.eventId) count++; });
      })
    );
    return count;
  }

  // Push all blocks lacking an eventId to Google Calendar (create events).
  // Used when turning sync on.
  async pushUnsyncedBlocks(googleCalendar, onProgress = null) {
    if (!googleCalendar || !googleCalendar.isAuthed) return 0;

    const prevSync = googleCalendar.syncEnabled;
    googleCalendar.syncEnabled = true; // ensure writes go through

    const total = this.countBlocksWithoutEvents();
    let pushed = 0;

    for (const task of this.tasks) {
      for (const st of task.subtasks) {
        if (st.done) continue; // don't recreate events for completed subtasks
        for (const b of st.blocks) {
          if (b.eventId) continue; // already synced
          try {
            const eventId = await googleCalendar.createEvent({
              summary: `${task.name}: ${st.name}`,
              description: st.note || '',
              startDate: b.date,
              startTime: b.start,
              hours: b.hours,
            });
            b.eventId = eventId;
            pushed++;
            if (onProgress) onProgress(pushed, total);
          } catch (e) {
            console.warn('Failed to push block:', e);
          }
        }
      }
    }

    googleCalendar.syncEnabled = prevSync; // restore
    this._save();
    return pushed;
  }

  // ---------- mutations ----------
  add(task) { this.tasks.push(task); this._save(); }

  async update(id, { name, subtasks }, googleCalendar) {
    const t = this.find(id);
    if (!t) return;

    const oldTaskName = t.name;
    const taskNameChanged = oldTaskName !== name;

    const renamedSubtasks = [];

    subtasks.forEach((ns) => {
      const old = t.subtasks.find((o) => o.id === ns.id);
      if (old) {
        if (old.blocks.length) ns.blocks = old.blocks;
        ns.done = old.done;
        ns.actualHours = old.actualHours;
        ns.note = old.note;          
        ns.waiting = old.waiting;    

        if (old.name !== ns.name) {
          renamedSubtasks.push({ subtask: ns, oldName: old.name, newName: ns.name });
        }
      }
    });

    t.name = name;
    t.subtasks = subtasks;
    this._save();

    if (googleCalendar && googleCalendar.isAuthed) {
      await this._updateEventTitles(t, taskNameChanged, renamedSubtasks, googleCalendar);
    }
  }

  // Update event titles when task/subtask names change
  async _updateEventTitles(task, taskNameChanged, renamedSubtasks, googleCalendar) {
    // If the TASK name changed, ALL subtasks' events need new titles
    // If only some subtasks were renamed, just those need updating
    const subtasksToUpdate = new Set();

    if (taskNameChanged) {
      // every subtask with events needs its title refreshed
      task.subtasks.forEach((st) => subtasksToUpdate.add(st));
    }
    renamedSubtasks.forEach(({ subtask }) => subtasksToUpdate.add(subtask));

    for (const st of subtasksToUpdate) {
      for (const b of st.blocks) {
        if (!b.eventId) continue;
        try {
          await googleCalendar.updateEvent({
            eventId: b.eventId,
            summary: `${task.name}: ${st.name}`,
            startDate: b.date,
            startTime: b.start,
            hours: b.hours,
          });
        } catch (e) {
          console.warn('Failed to update event title:', e);
        }
      }
    }
  }

  setSubtaskBlocks(taskId, subIndex, blocks) {
    const t = this.find(taskId);
    if (!t) return;
    t.subtasks[subIndex].blocks = blocks;
    this._save();
  }

  uncompleteSubtask(taskId, subIndex) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    st.done = false;
    st.actualHours = null;
    st.blocks = st.blocks.filter((b) => b.eventId !== null);
    this._save();
  }

  async deleteSubtaskEvents(st, scope, googleCalendar) {
    if (scope === 'none') return;
    if (!googleCalendar || !googleCalendar.isAuthed) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const b of st.blocks) {
      if (!b.eventId) continue;
      if (scope === 'future') {
        const blockDate = new Date(b.date + 'T00:00:00');
        if (blockDate < today) continue;
      }
      await googleCalendar.deleteEvent(b.eventId);
      b.eventId = null;
    }
  }

  async completeSubtask(taskId, subIndex, actualHours, scope, googleCalendar) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    await this.deleteSubtaskEvents(st, scope, googleCalendar);
    st.done = true;
    st.actualHours = actualHours;
    this._save();
  }

  toggleWaiting(taskId, subIndex) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    if (!st) return;
    st.waiting = !st.waiting;
    this._save();
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
    this._save();
  }

    // Log a completed subtask (one entry per subtask; updates if re-completed)
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

    const existingIdx = this.completionLog.findIndex(
      (e) => e.subtaskId === subtaskId
    );
    if (existingIdx >= 0) {
      this.completionLog[existingIdx] = entry;
    } else {
      this.completionLog.push(entry);
    }

    this._save();
  }

  getCompletionLog() {
    return this.completionLog;
  }

  setTaskNote(taskId, note) {
    const t = this.find(taskId);
    if (!t) return;
    t.note = note;
    this._save();
  }

  setSubtaskNote(taskId, subIndex, note) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    if (!st) return;
    st.note = note;
    this._save();
  }

  async deleteAllCalendarEvents(googleCalendar, onProgress = null) {
    if (!googleCalendar || !googleCalendar.isAuthed) return 0;

    const prevSync = googleCalendar.syncEnabled;
    googleCalendar.syncEnabled = true;

    // count total first (for progress)
    const total = this.countBlocksWithEvents();
    let deleted = 0;

    for (const task of this.tasks) {
      for (const st of task.subtasks) {
        for (const b of st.blocks) {
          if (!b.eventId) continue;
          try {
            await googleCalendar.deleteEvent(b.eventId);
            deleted++;
            if (onProgress) onProgress(deleted, total); // ← report progress
          } catch (e) {
            console.warn('Failed to delete event:', e);
          }
          b.eventId = null;
        }
      }
    }

    googleCalendar.syncEnabled = prevSync;
    this._save();
    return deleted;
  }

  // Count how many blocks currently have calendar events
  countBlocksWithEvents() {
    let count = 0;
    this.tasks.forEach((t) =>
      t.subtasks.forEach((st) =>
        st.blocks.forEach((b) => { if (b.eventId) count++; })
      )
    );
    return count;
  }
}