import { Subtask } from './Subtask.js';

// Pleasant, distinct palette
const PALETTE = [
  '#0a84ff', '#34c759', '#ff9500', '#ff2d55', '#af52de',
  '#5ac8fa', '#ffcc00', '#ff3b30', '#00c7be', '#a2845e',
];

let _colorIndex = 0;
export function nextColor() {
  const c = PALETTE[_colorIndex % PALETTE.length];
  _colorIndex++;
  return c;
}

export class Task {
  constructor({ id = null, name = '', subtasks = [], color = null } = {}) {
    this.id = id || Date.now().toString();
    this.name = name;
    this.color = color || nextColor();
    this.subtasks = subtasks.map((s) => new Subtask(s));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      subtasks: this.subtasks.map((s) => s.toJSON()),
    };
  }
}