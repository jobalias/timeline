// Owns the "schedule each new subtask in turn" sequence that follows saving a task.

export class SchedulingQueue {
  constructor(store, { openScheduler, onDiscardTask, onAdvanced }) {
    this.store = store;
    this.openScheduler = openScheduler;   // (taskId, subIndex, opts) → opens the calendar picker
    this.onDiscardTask = onDiscardTask;   // (taskId) → removes a task whose creation was cancelled
    this.onAdvanced = onAdvanced;         // () → re-render after a subtask was scheduled
    this.queue = [];                      // subtasks waiting to be scheduled in sequence
    this.currentTaskId = null;
  }

  start(taskId, newSubtaskIndices) {
    const task = this.store.find(taskId);
    if (!task || task.subtasks.length === 0) return;

    this.currentTaskId = taskId;

    // An array (even empty) is used exactly; only a missing value means "all".
    const indices = Array.isArray(newSubtaskIndices)
      ? newSubtaskIndices
      : task.subtasks.map((_, i) => i);

    this.queue = indices
      .map((i) => ({ taskId, subIndex: i, st: task.subtasks[i] }))
      .filter((x) => x.st && x.st.estHoursNum > 0 && !x.st.done);

    this._next();
  }

  // a one-off schedule request replaces any pending sequence
  clear() {
    this.queue = [];
  }

  // result: { cancelled, discardTask } or null (legacy)
  advance(result) {
    const cancelled = result === null || result?.cancelled;

    // user cancelled while creating the task → remove it
    if (result?.discardTask && this.currentTaskId) {
      this.onDiscardTask(this.currentTaskId);
    }

    if (cancelled) {
      this.queue = [];
      this.currentTaskId = null;
      return;
    }

    this._next();
    this.onAdvanced();
  }

  _next() {
    if (this.queue.length === 0) {
      this.currentTaskId = null;
      return;
    }
    const next = this.queue.shift();
    this.openScheduler(next.taskId, next.subIndex, { sequence: true });
  }
}
