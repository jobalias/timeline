import { Subtask } from './Subtask.js';

export class Task {
  constructor({ id = null, name = '', subtasks = [] } = {}) {
    this.id = id || Date.now().toString();
    this.name = name;
    this.subtasks = subtasks.map((s) => new Subtask(s));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      subtasks: this.subtasks.map((s) => s.toJSON()),
    };
  }
}