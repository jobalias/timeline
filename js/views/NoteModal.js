export class NoteModal {
  constructor(store, { onSaved = () => {} } = {}) {
    this.store = store;
    this.onSaved = onSaved;
    this.target = null; // { type: 'task'|'subtask', taskId, subIndex? }

    this.backdrop = document.getElementById('noteBackdrop');
    this.titleEl = document.getElementById('noteTitle');
    this.contextEl = document.getElementById('noteContext');
    this.textEl = document.getElementById('noteText');

    document.getElementById('noteCancelBtn')
      .addEventListener('click', () => this.close());
    document.getElementById('noteSaveBtn')
      .addEventListener('click', () => this._save());

    // click backdrop to close
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
  }

  openForTask(taskId) {
    const task = this.store.find(taskId);
    if (!task) return;
    this.target = { type: 'task', taskId };
    this.titleEl.textContent = '📝 Task Note';
    this.contextEl.textContent = task.name;
    this.textEl.value = task.note || '';
    this._open();
  }

  openForSubtask(taskId, subIndex) {
    const task = this.store.find(taskId);
    if (!task) return;
    const st = task.subtasks[subIndex];
    if (!st) return;
    this.target = { type: 'subtask', taskId, subIndex };
    this.titleEl.textContent = '📝 Subtask Note';
    this.contextEl.textContent = `${task.name} › ${st.name}`;
    this.textEl.value = st.note || '';
    this._open();
  }

  _open() {
    this.backdrop.classList.add('open');
    setTimeout(() => this.textEl.focus(), 50);
  }

  close() {
    this.backdrop.classList.remove('open');
    this.target = null;
  }

  _save() {
    if (!this.target) return;
    const note = this.textEl.value;

    if (this.target.type === 'task') {
      this.store.setTaskNote(this.target.taskId, note);
    } else {
      this.store.setSubtaskNote(this.target.taskId, this.target.subIndex, note);
    }

    const saved = { ...this.target, note };
    this.close();
    this.onSaved(saved); // Chunk 2 uses this to sync subtask notes → calendar
  }
}