import { Subtask } from './Subtask.js';

// Pleasant, distinct palette — 60 colors, interleaved by hue
// so consecutive colors contrast (no grouped reds/blues/etc.)
// Reads the autumn task palette from CSS custom properties (--task-01 … --task-NN)
function readPaletteFromCss() {
  const styles = getComputedStyle(document.documentElement);
  const colors = [];
  for (let i = 1; i <= 40; i++) {
    const v = styles.getPropertyValue(`--task-${String(i).padStart(2, '0')}`).trim();
    if (!v) break;        // stop at first missing one
    colors.push(v);
  }
  // fallback so the app never breaks if CSS hasn't loaded
  return colors.length ? colors : ['#b14e34', '#6b8e4e', '#c47d3f', '#3d7068'];
}

export const PALETTE = readPaletteFromCss();

let _colorIndex = 0;

export function nextColor(used_colors = null) {
  if (used_colors && used_colors.length > 0) {
    // find the first palette color not already in use (keeps them distinct + in order)
    const available = PALETTE.find((c) => !used_colors.includes(c));
    if (available) return available;
    // all 60 used → fall back to cycling by count
    return PALETTE[used_colors.length % PALETTE.length];
  }
  // no used-colors info → just cycle sequentially
  const c = PALETTE[_colorIndex % PALETTE.length];
  _colorIndex++;
  return c;
}

export class Task {
  constructor({ id, name = '', subtasks = [], color = null, note = '', persistent = false } = {}) {
    this.id = id || Date.now().toString();
    this.name = name;
    this.note = note;         
    this.persistent = persistent;
    this.subtasks = subtasks.map((s) => new Subtask(s));
    this.color = color || nextColor();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      note: this.note,     
      persistent: this.persistent,  
      color: this.color,
      subtasks: this.subtasks.map((s) => s.toJSON()),
    };
  }
}