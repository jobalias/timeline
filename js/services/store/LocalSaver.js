// LocalSaver owns the saved JSON shape and the 'taskGrid' localStorage slot.
import { Task } from '../../models/Task.js';

const STORAGE_KEY = 'taskGrid';

export const LocalSaver = {
  // the shape saved to both localStorage and Drive (key order matters for diffs)
  toJSON({ tasks, completionLog, calendarSyncEnabled, whiteboard }) {
    return {
      tasks: tasks.map((t) => t.toJSON()),
      completionLog,
      calendarSyncEnabled,
      whiteboard,
    };
  },

  save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON(state)));
  },

  // Returns { tasks, completionLog, calendarSyncEnabled, whiteboard }.
  // Older saves are a bare task array.
  load() {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const empty = { tasks: [], completionLog: [], calendarSyncEnabled: true, whiteboard: [] };
    if (!raw) return empty;
    if (Array.isArray(raw)) return { ...empty, tasks: raw.map((t) => new Task(t)) };
    return {
      tasks: (raw.tasks || []).map((t) => new Task(t)),
      completionLog: raw.completionLog || [],
      calendarSyncEnabled: raw.calendarSyncEnabled !== false,
      whiteboard: Array.isArray(raw.whiteboard) ? raw.whiteboard : [],
    };
  },
};
