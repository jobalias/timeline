import { Task } from '../models/Task.js';
import { Subtask } from '../models/Subtask.js';
import { escapeHtml } from '../utils.js';
import { startOfDay, parseLocalDate } from '../core/dates.js';
import { Modal } from '../core/Modal.js';

const normalizeName = (name) => name.trim().toLowerCase();

export class TaskModal extends Modal {
  constructor(store, googleCalendar, deleteDialog, { onAfterSave = () => {}, onNoteChanged = () => {} } = {}) {
    super('taskModalBackdrop');
    this.store = store;
    this.gcal = googleCalendar;
    this.deleteDialog = deleteDialog;
    this.onAfterSave = onAfterSave;
    this.onNoteChanged = onNoteChanged;   // ({ type: 'subtask', taskId, subIndex, note }) for edited notes
    this.editingId = null;
    this._afterSaveOnce = null;
    this._pendingEventDeletions = [];   // [{ subtask, scope }] — executed on Save, dropped on cancel

    this.title = document.getElementById('taskModalTitle');
    this.nameInput = document.getElementById('taskName');
    this.subtaskList = document.getElementById('subtaskList');
    this.saveBtn = document.getElementById('taskSaveBtn');

    document.getElementById('addSubtaskBtn').addEventListener('click', () => this._addSubtaskRow());
    document.getElementById('taskCancelBtn').addEventListener('click', () => this.close());
    this.saveBtn.addEventListener('click', () => this._save());
    this.nameInput.addEventListener('input', () => {
      if (!this.editingId) this._validateName();
    });
  }

  // ---------- public API ----------

  // prefill (optional): { name, subtasks: [{ name, estHours, due, wbId }] } — used by the Whiteboard
  openNew(prefill = null) {
    this._reset(null, 'Add Task', prefill?.name || '');
    const prefilled = prefill?.subtasks || [];
    prefilled.forEach((st) => this._addPrefilledRow(st));
    if (prefilled.length === 0) this._addSubtaskRow();
    this.show();

    if (prefill?.name) {
      this._validateName();
      this._focusFirstEmptyField();
    }
  }

  // extraSubtasks (optional): [{ name, estHours, due, wbId }] appended as new rows — used by the Whiteboard
  openEdit(id, { extraSubtasks = [] } = {}) {
    const task = this.store.find(id);
    if (!task) return;
    this._reset(id, extraSubtasks.length ? `Add to "${task.name}"` : 'Edit Task', task.name);
    task.subtasks.forEach((st) => this._addSubtaskRow(st));
    const firstNew = this.subtaskList.children.length;
    extraSubtasks.forEach((st) => this._addPrefilledRow(st));
    if (task.subtasks.length === 0 && extraSubtasks.length === 0) this._addSubtaskRow();
    this.show();

    if (extraSubtasks.length) this._highlightNewRows(firstNew);
  }

  // Run fn(savedId, wbLinks) once after the next successful save (cleared on cancel/reopen)
  setAfterSaveOnce(fn) { this._afterSaveOnce = fn; }

  close() {
    super.close();
    this._afterSaveOnce = null;
    this._pendingEventDeletions = [];   // cancelled → don't delete anything
  }

  // ---------- opening ----------
  _reset(editingId, title, name) {
    this.editingId = editingId;
    this._afterSaveOnce = null;
    this._pendingEventDeletions = [];
    this.title.textContent = title;
    this.nameInput.value = name;
    this.subtaskList.innerHTML = '';
  }

  show() {
    super.show();
    this._setNameState({ error: false });
  }

  // bring the appended rows into view and highlight them
  _highlightNewRows(fromIndex) {
    const rows = [...this.subtaskList.children].slice(fromIndex);
    rows.forEach((r) => r.classList.add('subtask-row-new'));
    rows[0].scrollIntoView({ block: 'center' });
    this._focusFirstEmptyField(rows[0]);
  }

  _focusFirstEmptyField(scope = this.subtaskList) {
    const field = [...scope.querySelectorAll('input[type=date], input[type=number]')].find((i) => !i.value);
    if (field) setTimeout(() => field.focus(), 50);
  }

  // ---------- subtask rows ----------
  _addPrefilledRow(st) {
    this._addSubtaskRow({ name: st.name, estHours: st.estHours || '', due: st.due || '', wbId: st.wbId });
  }

  _addSubtaskRow(data = {}) {
    const row = document.createElement('div');
    row.className = 'subtask-row';
    if (data.id) row.dataset.subtaskId = data.id;
    if (data.wbId) row.dataset.wbId = data.wbId;   // came from a whiteboard line
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
      </div>
      <button class="st-note-toggle" type="button">📝 Add note</button>
      <textarea class="st-note" rows="3" placeholder="Note for this subtask…"
        hidden>${data.note ? escapeHtml(data.note) : ''}</textarea>`;

    row.querySelector('.del-btn').addEventListener('click', () => this._removeSubtaskRow(row));
    row.querySelector('.st-note-toggle').addEventListener('click', () => this._showNote(row));
    if (data.note) this._showNote(row, { focus: false });
    this.subtaskList.appendChild(row);
  }

  // reveal a row's note box (the toggle button disappears once it's open)
  _showNote(row, { focus = true } = {}) {
    const note = row.querySelector('.st-note');
    note.hidden = false;
    row.querySelector('.st-note-toggle').hidden = true;
    if (focus) note.focus();
  }

  async _removeSubtaskRow(row) {
    const subtaskId = row.dataset.subtaskId;
    const subtask = subtaskId && this.editingId
      ? this.store.find(this.editingId)?.subtasks.find((s) => s.id === subtaskId)
      : null;

    // brand-new row, or nothing saved behind it → just drop it
    if (!subtask) {
      row.remove();
      return;
    }

    const hasEvents = subtask.blocks.some((b) => b.eventId);
    if (!hasEvents || !this.gcal.isAuthed) {
      if (confirm(`Remove subtask "${subtask.name}"?`)) row.remove();
      return;
    }

    const choice = await this.deleteDialog.open({
      title: `Remove "${subtask.name}"?`,
      message: 'This subtask has calendar events. What should happen to them?',
    });
    if (choice === 'cancel') return;

    // 'none' keeps the events; the others are deleted on Save
    if (choice === 'future' || choice === 'all') {
      this._pendingEventDeletions.push({ subtask, scope: choice });
    }
    row.remove();
  }

  // ---------- saving ----------
  async _save() {
    const name = this.nameInput.value.trim();
    if (!name) { alert('Please enter a task name'); return; }

    const { subtasks, wbLinks } = this._collectSubtasks();
    const result = this.editingId
      ? this._saveEdit(name, subtasks)
      : this._saveNew(name, subtasks);
    if (!result) return;
    const { savedId, newSubtaskIndices } = result;

    await this._executePendingDeletions();

    const afterOnce = this._afterSaveOnce;
    this.close();
    if (afterOnce) {
      try { afterOnce(savedId, wbLinks); } catch (e) { console.warn('afterSaveOnce failed', e); }
    }
    this.onAfterSave(savedId, newSubtaskIndices);
  }

  // subtasks from the filled-in rows, plus [{ wbId, subtaskId }] for rows that came from the whiteboard
  _collectSubtasks() {
    const subtasks = [];
    const wbLinks = [];
    this.subtaskList.querySelectorAll('.subtask-row').forEach((row) => {
      const [nameInput, dueInput, hoursInput] = row.querySelectorAll('input');
      const stName = nameInput.value.trim();
      if (!stName) return;
      const st = new Subtask({
        id: row.dataset.subtaskId || null,
        name: stName,
        due: dueInput.value,
        estHours: hoursInput.value,
        note: row.querySelector('.st-note').value,
      });
      subtasks.push(st);
      if (row.dataset.wbId) wbLinks.push({ wbId: row.dataset.wbId, subtaskId: st.id });
    });
    return { subtasks, wbLinks };
  }

  _saveEdit(name, subtasks) {
    const savedId = this.editingId;
    const previousNotes = new Map(this.store.find(savedId).subtasks.map((s) => [s.id, s.note || '']));
    this.store.update(savedId, { name, subtasks });

    const newSubtaskIndices = [];
    this.store.find(savedId).subtasks.forEach((s, i) => {
      if (!previousNotes.has(s.id)) newSubtaskIndices.push(i);
      else if (previousNotes.get(s.id) !== s.note) {
        this.onNoteChanged({ type: 'subtask', taskId: savedId, subIndex: i, note: s.note });
      }
    });
    return { savedId, newSubtaskIndices };
  }

  // returns null when the name is blocked by an ongoing task
  _saveNew(name, subtasks) {
    const { state, match } = this._classifyName(name);

    if (state === 'blocked') {
      this._validateName();   // save is disabled in this state, but guard anyway
      return null;
    }

    if (state === 'mergeable') {
      // append the new subtasks to the existing task — leave its old ones untouched
      const startIndex = this.store.appendSubtasks(match.id, subtasks);
      return { savedId: match.id, newSubtaskIndices: subtasks.map((_, i) => startIndex + i) };
    }

    const task = new Task({ name, subtasks });
    this.store.add(task);
    return { savedId: task.id, newSubtaskIndices: task.subtasks.map((_, i) => i) };
  }

  async _executePendingDeletions() {
    if (!this._pendingEventDeletions.length || !this.gcal.isAuthed) {
      this._pendingEventDeletions = [];
      return;
    }

    const today = startOfDay(new Date());

    for (const { subtask, scope } of this._pendingEventDeletions) {
      for (const block of subtask.blocks) {
        if (!block.eventId) continue;
        if (scope === 'future' && parseLocalDate(block.date) < today) continue;
        try {
          await this.gcal.deleteEvent(block.eventId);
        } catch (e) {
          console.warn('Failed to delete event for removed subtask:', e);
        }
      }
    }
    this._pendingEventDeletions = [];
  }

  // ---------- name validation ----------
  _findMatch(name) {
    const target = normalizeName(name);
    return this.store.getAll().find((t) => normalizeName(t.name) === target && t.id !== this.editingId);
  }

  _isTaskDone(t) {
    return t.subtasks.length > 0 && t.subtasks.every((s) => s.done);
  }

  // { state: 'ok' | 'blocked' | 'mergeable', match }
  // a finished or empty namesake can absorb the new subtasks; an ongoing one blocks the name
  _classifyName(name) {
    const match = this._findMatch(name);
    if (!match) return { state: 'ok', match: null };
    const mergeable = this._isTaskDone(match) || match.subtasks.length === 0;
    return { state: mergeable ? 'mergeable' : 'blocked', match };
  }

  _validateName() {
    const name = this.nameInput.value.trim();
    const state = name ? this._classifyName(name).state : 'ok';

    if (state === 'blocked') {
      this._setNameState({ error: true, note: 'A task with this name already exists.' });
    } else if (state === 'mergeable') {
      this._setNameState({ error: false, note: 'Matches an existing task — your subtasks will be added to it.', info: true });
    } else {
      this._setNameState({ error: false });
    }
  }

  _setNameState({ error, note = '', info = false }) {
    this.nameInput.classList.toggle('input-error', error);
    this.saveBtn.disabled = error;
    if (note) this._showNameNote(note, info);
    else this._clearNameNote();
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
