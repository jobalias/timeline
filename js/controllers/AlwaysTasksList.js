// Owns the "Always Tasks" section of settings: the list, the add box and its inline error.

import { Task } from '../models/Task.js';
import { escapeHtml } from '../utils.js';

export class AlwaysTasksList {
  constructor(store, { onDeleteTask }) {
    this.store = store;
    this.onDeleteTask = onDeleteTask;
    this.input = document.getElementById('alwaysAddInput');

    const add = () => {
      const name = this.input.value.trim();
      if (name) this._add(name);
    };
    document.getElementById('alwaysAddBtn').addEventListener('click', add);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
    });
  }

  render() {
    const list = document.getElementById('alwaysTaskList');
    if (!list) return;
    const always = this.store.getAll().filter((t) => t.persistent);

    if (always.length === 0) {
      list.innerHTML = '<div class="always-empty">No always-tasks yet.</div>';
      return;
    }

    list.innerHTML = always.map((t) => `
      <div class="always-row" data-task-id="${t.id}">
        <span>${escapeHtml(t.name)}</span>
        <button class="always-del" data-task-id="${t.id}" title="Remove">➖</button>
      </div>
    `).join('');

    list.querySelectorAll('.always-del').forEach((btn) => {
      btn.addEventListener('click', () => this.onDeleteTask(btn.dataset.taskId));
    });
  }

  // New name → create it; existing normal task → offer to convert; existing always task → error.
  _add(name) {
    const match = this._findTaskByName(name);

    if (!match) {
      this.store.add(new Task({ name: name.trim(), persistent: true }));
      this._resetInput();
      return;
    }

    if (match.persistent) {
      this._flashError('Already an always task.');
      return;
    }

    const ok = confirm(
      `"${match.name}" already exists. Make it an always task?\n\n` +
      `(It keeps its current subtasks — click Cancel to use a different name.)`
    );
    if (!ok) {
      this.input.focus();
      return;
    }

    this.store.setPersistent(match.id, true);
    this._resetInput();
  }

  // case-insensitive, trimmed name match
  _findTaskByName(name) {
    const norm = name.trim().toLowerCase();
    return this.store.getAll().find((t) => t.name.trim().toLowerCase() === norm);
  }

  _resetInput() {
    this.input.value = '';
    this._clearError();
    this.render();
  }

  _flashError(msg) {
    this.input.classList.add('input-error');

    let note = document.getElementById('alwaysAddNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'alwaysAddNote';
      note.style.cssText = 'color:var(--danger);font-size:12px;margin-top:4px;';
      this.input.closest('.settings-expand-body').appendChild(note);
    }
    note.textContent = msg;
    this.input.addEventListener('input', () => this._clearError(), { once: true });
  }

  _clearError() {
    this.input.classList.remove('input-error');
    const note = document.getElementById('alwaysAddNote');
    if (note) note.textContent = '';
  }
}
