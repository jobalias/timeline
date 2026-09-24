import { Task } from '../models/Task.js';

const STORAGE_KEY = 'taskGrid';

export class TaskStore {
  constructor() {
    this.tasks = this._loadLocal();
    this.listeners = [];
    this.drive = null;          // set via attachDrive()
    this.syncStatusFn = () => {}; // UI callback
    this._saveTimer = null;
  }

  // ---------- Drive wiring ----------
  attachDrive(drive) {
    this.drive = drive;
  }

  onSyncStatus(fn) {
    this.syncStatusFn = fn;
  }

  // Called after Google connects: pull from Drive (last-write-wins = Drive wins on load)
  async loadFromDrive() {
    if (!this.drive) { this._setStatus('offline'); return; }
    this._setStatus('saving');
    const remote = await this.drive.load();
    if (remote && Array.isArray(remote)) {
      this.tasks = remote.map((t) => new Task(t));
      this._saveLocal();
      this._notify();
      this._setStatus('synced');
    } else {
      await this._saveRemote(); // creates the file; sets status
    }
  }

  // ---------- persistence ----------
  _loadLocal() {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return raw.map((t) => new Task(t));
  }

  _saveLocal() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(this.tasks.map((t) => t.toJSON()))
    );
  }

  async _saveRemote() {
    if (!this.drive || !this.drive.isReady) {
      this._setStatus('offline');
      return;
    }
    this._setStatus('saving');
    const ok = await this.drive.save(this.tasks.map((t) => t.toJSON()));
    this._setStatus(ok ? 'synced' : 'failed');
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
    return [...this.tasks].sort(
      (a, b) => (isTaskDone(a) ? 1 : 0) - (isTaskDone(b) ? 1 : 0)
    );
  }

  // ---------- mutations ----------
  add(task) { this.tasks.push(task); this._save(); }

  update(id, { name, subtasks }) {
    const t = this.find(id);
    if (!t) return;
    subtasks.forEach((ns) => {
      const old = t.subtasks.find((o) => o.name === ns.name);
      if (old && old.blocks.length) ns.blocks = old.blocks;
    });
    t.name = name;
    t.subtasks = subtasks;
    this._save();
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
}