import { Modal } from '../core/Modal.js';

export class NoteModal extends Modal {
  constructor(store, { onSaved = () => {} } = {}) {
    super('noteBackdrop', { closeOnBackdrop: true });
    this.store = store;
    this.onSaved = onSaved;
    this.target = null;   // { type: 'task' | 'subtask', taskId, subIndex? }

    this.titleEl = document.getElementById('noteTitle');
    this.contextEl = document.getElementById('noteContext');
    this.textEl = document.getElementById('noteText');

    document.getElementById('noteCancelBtn').addEventListener('click', () => this.close());
    document.getElementById('noteSaveBtn').addEventListener('click', () => this._save());
  }

  openForTask(taskId) {
    const task = this.store.find(taskId);
    if (!task) return;
    this._open({ type: 'task', taskId }, '📝 Task Note', task.name, task.note);
  }

  openForSubtask(taskId, subIndex) {
    const task = this.store.find(taskId);
    const st = task?.subtasks[subIndex];
    if (!st) return;
    this._open({ type: 'subtask', taskId, subIndex }, '📝 Subtask Note', `${task.name} › ${st.name}`, st.note);
  }

  close() {
    super.close();
    this.target = null;
  }

  _open(target, title, context, note) {
    this.target = target;
    this.titleEl.textContent = title;
    this.contextEl.textContent = context;
    this.textEl.value = note || '';
    this.show();
    setTimeout(() => this.textEl.focus(), 50);
  }

  _save() {
    if (!this.target) return;
    const { type, taskId, subIndex } = this.target;
    const note = this.textEl.value;

    if (type === 'task') this.store.setTaskNote(taskId, note);
    else this.store.setSubtaskNote(taskId, subIndex, note);

    const saved = { ...this.target, note };
    this.close();
    this.onSaved(saved);
  }
}
