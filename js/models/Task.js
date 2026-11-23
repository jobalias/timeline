import { Subtask } from './Subtask.js';

const MAX_PALETTE_SIZE = 40;
const FALLBACK_PALETTE = ['#b14e34', '#6b8e4e', '#c47d3f', '#3d7068'];

// Reads the task palette from CSS custom properties (--task-01 … --task-NN),
// stopping at the first one that isn't defined.
function readPaletteFromCss() {
  const styles = getComputedStyle(document.documentElement);
  const colors = [];
  for (let i = 1; i <= MAX_PALETTE_SIZE; i++) {
    const color = styles.getPropertyValue(`--task-${String(i).padStart(2, '0')}`).trim();
    if (!color) break;
    colors.push(color);
  }
  // Fallback so the app never breaks if the CSS hasn't loaded
  return colors.length ? colors : FALLBACK_PALETTE;
}

export const PALETTE = readPaletteFromCss();

let colorIndex = 0;

// Picks the first palette color not in `usedColors` (keeping colors distinct and
// in palette order); without usage info, simply cycles through the palette.
export function nextColor(usedColors = null) {
  if (usedColors && usedColors.length > 0) {
    const available = PALETTE.find((c) => !usedColors.includes(c));
    return available || PALETTE[usedColors.length % PALETTE.length];
  }
  return PALETTE[colorIndex++ % PALETTE.length];
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
