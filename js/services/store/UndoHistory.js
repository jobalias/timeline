// UndoHistory owns the undo/redo stacks of JSON snapshots and tells listeners what changed.

const UNDO_LIMIT = 5;            // how many actions you can undo
const CHAIN_MS = 400;            // saves this close together (one action doing 2 saves) = one undo step

export class UndoHistory {
  // serialize() returns the current state as a JSON snapshot string
  constructor(serialize) {
    this._serialize = serialize;
    this._undo = [];
    this._redo = [];
    this._snap = serialize();
    this._lastKey = null;
    this._lastChangeAt = 0;
    this._listeners = [];
  }

  onChange(fn) { this._listeners.push(fn); }

  canUndo() { return this._undo.length > 0; }
  canRedo() { return this._redo.length > 0; }

  // Called on every save. opts.history === false → not an undo step (e.g. calendar sync).
  // opts.coalesce = key → consecutive saves with the same key (typing in one line) merge.
  record({ history = true, coalesce = null } = {}) {
    const now = this._serialize();
    if (now === this._snap) return;
    const prev = this._snap;
    this._snap = now;
    if (!history) return;

    const t = Date.now();
    const merge = (coalesce && coalesce === this._lastKey) ||
                  (!coalesce && !this._lastKey && t - this._lastChangeAt < CHAIN_MS);
    if (!merge || this._undo.length === 0) this._pushUndo(prev);
    this._redo = [];
    this._lastKey = coalesce;
    this._lastChangeAt = t;
    this.emit(describeDeletion(prev, now));
  }

  // Snapshot to restore for undo, or null if there is nothing to undo.
  stepBack() {
    if (!this._undo.length) return null;
    this._redo.push(this._snap);
    return this._undo.pop();
  }

  // Snapshot to restore for redo, or null if there is nothing to redo.
  stepForward() {
    if (!this._redo.length) return null;
    this._pushUndo(this._snap);
    return this._redo.pop();
  }

  // The state now matches `json` (after an undo/redo restore).
  markRestored(json) {
    this._snap = json;
    this._lastKey = null;
    this._lastChangeAt = 0;
  }

  // Fresh data (e.g. loaded from Drive) → fresh history.
  reset() {
    this._undo = [];
    this._redo = [];
    this._snap = this._serialize();
    this._lastKey = null;
    this.emit();
  }

  emit(deleted = null) {
    const info = { canUndo: this.canUndo(), canRedo: this.canRedo(), deleted };
    this._listeners.forEach((fn) => fn(info));
  }

  _pushUndo(snapshot) {
    this._undo.push(snapshot);
    if (this._undo.length > UNDO_LIMIT) this._undo.shift();
  }
}

// "Deleted task “X”" etc. when something disappeared, so the UI can offer a quick Undo
function describeDeletion(prevJson, nowJson) {
  try {
    const before = JSON.parse(prevJson);
    const after = JSON.parse(nowJson);
    const idsOf = (arr) => new Set(arr.map((x) => x.id));
    const subtasksOf = (tasks) => tasks.flatMap((t) => t.subtasks);

    const keptTaskIds = idsOf(after.tasks);
    const goneTasks = before.tasks.filter((t) => !keptTaskIds.has(t.id));
    const keptSubIds = idsOf(subtasksOf(after.tasks));
    const goneSubs = subtasksOf(before.tasks.filter((t) => keptTaskIds.has(t.id)))
      .filter((s) => !keptSubIds.has(s.id));
    const keptLineIds = idsOf(after.whiteboard || []);
    const goneLines = (before.whiteboard || [])
      .filter((l) => !keptLineIds.has(l.id) && (l.text || '').trim());

    const total = goneTasks.length + goneSubs.length + goneLines.length;
    if (total === 0) return null;
    if (total > 1) return `Deleted ${total} items`;
    const quote = (s) => `“${(s || '').trim()}”`;
    if (goneTasks.length) return `Deleted task ${quote(goneTasks[0].name)}`;
    if (goneSubs.length) return `Deleted subtask ${quote(goneSubs[0].name)}`;
    return `Deleted ${quote(goneLines[0].text)} from the whiteboard`;
  } catch {
    return null;
  }
}
