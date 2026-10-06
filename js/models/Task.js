import { Subtask } from './Subtask.js';

// Pleasant, distinct palette — 60 colors, interleaved by hue
// so consecutive colors contrast (no grouped reds/blues/etc.)
export const PALETTE = [
  '#ff6b6b', // red
  '#40c057', // green
  '#4dabf7', // blue
  '#ff922b', // orange
  '#9775fa', // violet
  '#22b8cf', // cyan
  '#f06595', // pink
  '#82c91e', // lime
  '#5c7cfa', // indigo
  '#f59f00', // gold
  '#cc5de8', // grape
  '#12b886', // teal
  '#ff8787', // light red
  '#37b24d', // deep green
  '#339af0', // bright blue
  '#fd7e14', // deep orange
  '#845ef7', // deep violet
  '#15aabf', // deep cyan
  '#e64980', // magenta
  '#69db7c', // mint
  '#4c6ef5', // royal blue
  '#fab005', // amber
  '#be4bdb', // purple
  '#0ca678', // deep teal
  '#ff5c8a', // rose
  '#2f9e44', // forest
  '#228be6', // ocean
  '#ffa94d', // apricot
  '#7048e8', // indigo-violet
  '#3bc9db', // sky cyan
  '#d6336c', // berry
  '#51cf66', // spring green
  '#1c7ed6', // steel blue
  '#f76707', // pumpkin
  '#b197fc', // lavender
  '#1098ad', // petrol
  '#e599f7', // orchid
  '#20c997', // seafoam
  '#748ffc', // periwinkle
  '#e8a90c', // mustard
  '#ae3ec9', // deep purple
  '#099268', // pine
  '#ff6f91', // coral pink
  '#66a80f', // olive green
  '#3b5bdb', // deep blue
  '#e67700', // burnt orange
  '#da77f2', // light purple
  '#0c8599', // teal blue
  '#a1887f', // taupe
  '#5c940d', // moss
  '#6741d9', // blurple
  '#f08c00', // marigold
  '#8d6e63', // brown
  '#0b7285', // dark cyan
  '#c2255c', // raspberry
  '#2b8a3e', // emerald
  '#364fc7', // navy
  '#bc8a5f', // tan
  '#9c36b5', // plum
  '#087f5b', // deep seafoam
];

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
  constructor({ id, name = '', subtasks = [], color = null, note = '' } = {}) {
    this.id = id || Date.now().toString();
    this.name = name;
    this.note = note;                     // ← add
    this.subtasks = subtasks.map((s) => new Subtask(s));
    this.color = color || nextColor();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      note: this.note,                    // ← add
      color: this.color,
      subtasks: this.subtasks.map((s) => s.toJSON()),
    };
  }
}