// Owns user flows that change a task's lifecycle: delete, discard, complete/un-complete,
// and mirroring subtask notes into their calendar events.

export class TaskActions {
  constructor(store, gcal, deleteDialog, grid, { onAlwaysTasksChanged = () => {} } = {}) {
    this.store = store;
    this.gcal = gcal;
    this.deleteDialog = deleteDialog;
    this.grid = grid;
    this.onAlwaysTasksChanged = onAlwaysTasksChanged;
  }

  // ==================== Delete ====================
  async deleteTask(id) {
    const task = this.store.find(id);
    if (!task) return;

    if (task.persistent && await this._deleteAlwaysTask(task)) return;

    if (!this._hasCalendarEvents(task) || !this.gcal.isAuthed) {
      if (confirm(`Delete "${task.name}" and all its subtasks?`)) {
        await this.store.removeTask(id, 'none', this.gcal);
      }
      this.onAlwaysTasksChanged();
      return;
    }

    const choice = await this.deleteDialog.open({
      title: `Delete "${task.name}"?`,
      message: 'This task has calendar events. What should happen to them?',
    });
    if (choice === 'cancel') return;

    await this.store.removeTask(id, choice, this.gcal);
    this.onAlwaysTasksChanged();
  }

  // Returns true when fully handled; false means "delete everything" was chosen
  // and the normal deletion flow (with its calendar-event prompt) should continue.
  async _deleteAlwaysTask(task) {
    if (task.subtasks.length === 0) {
      await this.store.removeTask(task.id, 'none', this.gcal);
      this.onAlwaysTasksChanged();
      return true;
    }

    const choice = await this.deleteDialog.open({
      title: `Delete "${task.name}"?`,
      message: 'This is an Always Task with subtasks. Delete everything, or just make it a normal task?',
      labels: {
        all: '🗑 Delete task and all subtasks',
        none: '📌 Keep it — just make it non-persistent',
        cancel: 'Cancel',
      },
      hide: ['future'],
    });

    if (choice === 'cancel') return true;

    if (choice === 'none') {
      this.store.setPersistent(task.id, false);
      this.onAlwaysTasksChanged();
      return true;
    }
    return false;
  }

  // ==================== Clear completed ====================
  async clearCompleted() {
    const { subtasks, tasks } = this.store.countCompleted();
    if (subtasks === 0 && tasks === 0) {
      alert('Nothing completed to clear.');
      return;
    }

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts = [];
    if (subtasks) parts.push(`${plural(subtasks, 'completed subtask')} in unfinished tasks`);
    if (tasks) parts.push(`${plural(tasks, 'fully completed task')}`);

    const choice = await this.deleteDialog.open({
      title: 'Clear completed?',
      message: `You have ${parts.join(' and ')}. Your Progress history stays, and you can undo this.`,
      labels: {
        none: `✂️ Clear completed subtasks only${tasks ? ' (keep finished tasks)' : ''}`,
        all: '🗑 Clear completed tasks AND subtasks',
        cancel: 'Cancel',
      },
      hide: ['future', ...(subtasks ? [] : ['none']), ...(tasks ? [] : ['all'])],
    });
    if (choice === 'cancel') return;

    this.store.clearCompleted({ includeTasks: choice === 'all' });
  }

  // silently remove a task whose creation was cancelled mid-scheduling
  async discardTask(taskId) {
    const task = this.store.find(taskId);
    if (!task) return;

    // earlier subtasks in the sequence may already have Google events
    const scope = this._hasCalendarEvents(task) && this.gcal.isAuthed ? 'all' : 'none';
    await this.store.removeTask(taskId, scope, this.gcal);
  }

  _hasCalendarEvents(task) {
    return task.subtasks.some((s) => s.blocks.some((b) => b.eventId));
  }

  // ==================== Complete / Un-complete ====================
  async toggleDone(taskId, subIndex, checked) {
    if (!checked) {
      this.store.uncompleteSubtask(taskId, subIndex);
      return;
    }

    const st = this.store.find(taskId).subtasks[subIndex];
    const actual = this._askHoursSpent(st);
    if (actual === null) {
      this._resetGrid();
      return;
    }

    let scope = 'none';
    if (st.blocks.some((b) => b.eventId) && this.gcal.isAuthed) {
      scope = await this.deleteDialog.open({
        title: 'Task complete!',
        message: 'What should happen to the remaining calendar events?',
      });
      if (scope === 'cancel') {
        this.grid.render();
        return;
      }
    }

    await this.store.completeSubtask(taskId, subIndex, actual, scope, this.gcal);
    this._logCompletion(taskId, subIndex, actual);
  }

  // Returns the hours entered, or null if the prompt was cancelled or invalid.
  _askHoursSpent(st) {
    const input = prompt(
      `Marking "${st.name}" as done.\nHow many hours did you actually spend?`,
      st.allocatedHours || st.estHoursNum || 0
    );
    if (input === null) return null;

    const actual = parseFloat(input);
    if (isNaN(actual) || actual < 0) {
      alert('Please enter a valid number of hours.');
      return null;
    }
    return actual;
  }

  _logCompletion(taskId, subIndex, hoursSpent) {
    // re-fetch: the store may have replaced the objects
    const task = this.store.find(taskId);
    const completed = task.subtasks[subIndex];
    this.store.logCompletion({
      taskId: task.id,
      taskName: task.name,
      subtaskName: completed.name,
      subtaskId: completed.id,
      hoursSpent,
      taskJustCompleted: task.subtasks.every((s) => s.done),
    });
  }

  // re-render so the un-applied checkbox goes back to unchecked
  _resetGrid() {
    this.grid.render();
    this.grid.onShow();
  }

  // ==================== Notes ====================
  // Subtask notes are mirrored into their calendar events; task notes are app-only.
  async syncNoteToCalendar({ type, taskId, subIndex, note }) {
    if (type !== 'subtask' || !this.gcal.isAuthed) return;

    const st = this.store.find(taskId)?.subtasks[subIndex];
    if (!st) return;

    for (const b of st.blocks) {
      if (!b.eventId) continue;
      try {
        await this.gcal.updateEventDescription(b.eventId, note);
      } catch (e) {
        console.warn('Failed to sync note to event:', e);
      }
    }
  }
}
