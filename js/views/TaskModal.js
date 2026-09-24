import { Task } from '../models/Task.js';
import { Subtask } from '../models/Subtask.js';
import { escapeHtml } from '../utils.js';

export class TaskModal {
  constructor(store, { onAfterSave = () => {} } = {}) {
    this.store = store;
    this.onAfterSave = onAfterSave;
    this.editingId = null;

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
  }

  openNew() {
    this.editingId = null;
    this.title.textContent = 'Add Task';
    this.nameInput.value = '';
    this.subtaskList.innerHTML = '';
    this._addSubtaskRow();
    this.backdrop.classList.add('open');
  }

  openEdit(id) {
    const t = this.store.find(id);
    if (!t) return;
    this.editingId = id;
    this.title.textContent = 'Edit Task';
    this.nameInput.value = t.name;
    this.subtaskList.innerHTML = '';
    t.subtasks.forEach((st) => this._addSubtaskRow(st));
    if (t.subtasks.length === 0) this._addSubtaskRow();
    this.backdrop.classList.add('open');
  }

  close() {
    this.backdrop.classList.remove('open');
  }

  _addSubtaskRow(data = {}) {
    const row = document.createElement('div');
    row.className = 'subtask-row';
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
      .addEventListener('click', () => row.remove());
    this.subtaskList.appendChild(row);
  }

  _save() {
    const name = this.nameInput.value.trim();
    if (!name) {
      alert('Please enter a task name');
      return;
    }
    const rows = this.subtaskList.querySelectorAll('.subtask-row');
    const subtasks = [];
    rows.forEach((r) => {
      const inputs = r.querySelectorAll('input');
      const stName = inputs[0].value.trim();
      if (!stName) return;
      subtasks.push(
        new Subtask({
          name: stName,
          due: inputs[1].value,
          estHours: inputs[2].value,
        })
      );
    });

    let savedId;
    if (this.editingId) {
      this.store.update(this.editingId, { name, subtasks });
      savedId = this.editingId;
    } else {
      const task = new Task({ name, subtasks });
      this.store.add(task);
      savedId = task.id;
    }
    this.close();
    this.onAfterSave(savedId);
  }
}