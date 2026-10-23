import { Task } from '../models/Task.js';
import { Subtask } from '../models/Subtask.js';
import { escapeHtml } from '../utils.js';

export class TaskModal {
  constructor(store, googleCalendar, deleteDialog, { onAfterSave = () => {} } = {}) {
    this.store = store;
    this.gcal = googleCalendar;
    this.deleteDialog = deleteDialog;
    this.onAfterSave = onAfterSave;
    this.editingId = null;
    // track events to delete on save (chosen when ✕ clicked)
    this._pendingEventDeletions = [];

    this.backdrop = document.getElementById('taskModalBackdrop');
    this.title = document.getElementById('taskModalTitle');
    this.nameInput = document.getElementById('taskName');
    this.subtaskList = document.getElementById('subtaskList');

    document.getElementById('addSubtaskBtn')
      .addEventListener('click', () => this._addSubtaskRow());
    document.getElementById('taskCancelBtn')
      .addEventListener('click', () => this.close());
    document.getElementById('taskSaveBtn')
      .addEventListener('click', () => this._save());
    this.nameInput.addEventListener('input', () => {
      if (this.editingId) return;
      this._validateName();
    });
  }

  openNew() {
    this.editingId = null;
    this._pendingEventDeletions = []; // ← reset
    this.title.textContent = 'Add Task';
    this.nameInput.value = '';
    this.subtaskList.innerHTML = '';
    this._addSubtaskRow();
    this.backdrop.classList.add('open');

    this.nameInput.classList.remove('input-error');
    document.getElementById('taskSaveBtn').disabled = false;
    this._clearNameNote();
  }

  openEdit(id) {
    const t = this.store.find(id);
    if (!t) return;
    this.editingId = id;
    this._pendingEventDeletions = []; // ← reset
    this.title.textContent = 'Edit Task';
    this.nameInput.value = t.name;
    this.subtaskList.innerHTML = '';
    t.subtasks.forEach((st) => this._addSubtaskRow(st));
    if (t.subtasks.length === 0) this._addSubtaskRow();
    this.backdrop.classList.add('open');

    this.nameInput.classList.remove('input-error');
    document.getElementById('taskSaveBtn').disabled = false;
    this._clearNameNote();
  }

  close() {
    this.backdrop.classList.remove('open');
    this._pendingEventDeletions = []; // ← reset (don't delete if they cancelled)
  }

  _addSubtaskRow(data = {}) {
    const row = document.createElement('div');
    row.className = 'subtask-row';
    if (data.id) row.dataset.subtaskId = data.id;
    row.innerHTML = `
      <button class="del-btn">✕</button>
      <input class="name-input" type="text" placeholder="Subtask name"
        value="${data.name ? escapeHtml(data.name) : ''}">
      <div class="date-fields">
        <div class="field"><label>Due date</label>
          <input type="date" value="${data.due || ''}"></div>
        <div class="field"><label>Est. hours</label>
          <input type="number" min="0" step="0.5" placeholder="e.g. 6"
            value="${data.estHours || ''}"></div>
      </div>`;

    row.querySelector('.del-btn')
      .addEventListener('click', () => this._removeSubtaskRow(row));

    this.subtaskList.appendChild(row);
  }

  async _removeSubtaskRow(row) {
    const subtaskId = row.dataset.subtaskId;

    // If it's a brand-new row (no ID) or we're adding a task, just remove it
    if (!subtaskId || !this.editingId) {
      row.remove();
      return;
    }

    // Find the subtask in the store to check for calendar events
    const task = this.store.find(this.editingId);
    const st = task?.subtasks.find((s) => s.id === subtaskId);

    if (!st) {
      row.remove();
      return;
    }

    const hasEvents = st.blocks.some((b) => b.eventId);

    if (!hasEvents || !this.gcal.isAuthed) {
      // no events → simple confirm
      if (confirm(`Remove subtask "${st.name}"?`)) {
        row.remove();
      }
      return;
    }

    // has events → ask what to do with them
    const choice = await this.deleteDialog.open({
      title: `Remove "${st.name}"?`,
      message: 'This subtask has calendar events. What should happen to them?',
    });

    if (choice === 'cancel') return; // don't remove the row

    // record the event-deletion intent (executed on Save)
    if (choice === 'future' || choice === 'all') {
      this._pendingEventDeletions.push({ subtask: st, scope: choice });
    }
    // 'none' → keep events, just remove the row

    row.remove();
  }

  async _save() {
    const name = this.nameInput.value.trim();
    if (!name) { alert('Please enter a task name'); return; }

    const rows = this.subtaskList.querySelectorAll('.subtask-row');
    const subtasks = [];
    rows.forEach((r) => {
      const inputs = r.querySelectorAll('input');
      const stName = inputs[0].value.trim();
      if (!stName) return;
      subtasks.push(new Subtask({
        id: r.dataset.subtaskId || null,
        name: stName,
        due: inputs[1].value,
        estHours: inputs[2].value,
      }));
    });

    let savedId;
    let newSubtaskIndices = [];

    if (this.editingId) {
      const existing = this.store.find(this.editingId);
      const existingIds = new Set(existing.subtasks.map((s) => s.id));

      this.store.update(this.editingId, { name, subtasks });
      savedId = this.editingId;

      const updated = this.store.find(savedId);
      updated.subtasks.forEach((s, i) => {
        if (!existingIds.has(s.id)) newSubtaskIndices.push(i);
      });
    } else {
      // not editing — check for a name match
      const { state, match } = this._classifyName(name);

      if (state === 'blocked') {
        // shouldn't happen (save is disabled), but guard anyway
        this._validateName();
        return;
      }

      if (state === 'mergeable' && match) {
        // append NEW subtasks directly to the existing task — don't touch old ones
        const startIndex = match.subtasks.length;

        // `subtasks` here are the new Subtask instances from the modal (done=false, correct)
        match.subtasks.push(...subtasks);

        // persist + notify
        this.store._save();

        savedId = match.id;
        // new subtasks occupy indices [startIndex ... end]
        newSubtaskIndices = subtasks.map((_, i) => startIndex + i);
      } else {
        // truly new task
        const task = new Task({ name, subtasks });
        this.store.add(task);
        savedId = task.id;
        newSubtaskIndices = task.subtasks.map((_, i) => i);
      }
    }

    // execute any pending calendar-event deletions from removed subtasks
    await this._executePendingDeletions();

    this.close();
    this.onAfterSave(savedId, newSubtaskIndices);
  }

  async _executePendingDeletions() {
    if (!this._pendingEventDeletions.length || !this.gcal.isAuthed) {
      this._pendingEventDeletions = [];
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const { subtask, scope } of this._pendingEventDeletions) {
      for (const b of subtask.blocks) {
        if (!b.eventId) continue;
        if (scope === 'future') {
          const blockDate = new Date(b.date + 'T00:00:00');
          if (blockDate < today) continue;
        }
        try {
          await this.gcal.deleteEvent(b.eventId);
        } catch (e) {
          console.warn('Failed to delete event for removed subtask:', e);
        }
      }
    }
    this._pendingEventDeletions = [];
  }
  _findMatch(name) {
    const norm = name.trim().toLowerCase();
    return this.store.getAll().find(
      (t) => t.name.trim().toLowerCase() === norm && t.id !== this.editingId
    );
  }

  _isTaskDone(t) {
    return t.subtasks.length > 0 && t.subtasks.every((s) => s.done);
  }

  // { state: 'ok' | 'blocked' | 'mergeable', match }
  _classifyName(name) {
    const match = this._findMatch(name);
    if (!match) return { state: 'ok', match: null };
    // Option A: completed OR empty → mergeable; ongoing → blocked
    const mergeable = this._isTaskDone(match) || match.subtasks.length === 0;
    return { state: mergeable ? 'mergeable' : 'blocked', match };
  }

  _validateName() {
    const name = this.nameInput.value.trim();
    const saveBtn = document.getElementById('taskSaveBtn');

    if (!name) {
      this.nameInput.classList.remove('input-error');
      saveBtn.disabled = false;
      this._clearNameNote();
      return 'ok';
    }

    const { state } = this._classifyName(name);

    if (state === 'blocked') {
      this.nameInput.classList.add('input-error');
      saveBtn.disabled = true;
      this._showNameNote('A task with this name already exists.');
    } else if (state === 'mergeable') {
      this.nameInput.classList.remove('input-error');
      saveBtn.disabled = false;
      this._showNameNote('Matches an existing task — your subtasks will be added to it.', true);
    } else {
      this.nameInput.classList.remove('input-error');
      saveBtn.disabled = false;
      this._clearNameNote();
    }
    return state;
  }

  _showNameNote(msg, info = false) {
    let note = document.getElementById('taskNameNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'taskNameNote';
      note.style.cssText = 'font-size:12px;margin-top:4px;';
      this.nameInput.insertAdjacentElement('afterend', note);
    }
    note.style.color = info ? 'var(--muted)' : 'var(--danger)';
    note.textContent = msg;
  }

  _clearNameNote() {
    const note = document.getElementById('taskNameNote');
    if (note) note.textContent = '';
  }
}