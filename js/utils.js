import { parseLocalDate } from './core/dates.js';

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// True when the subtask isn't done and its due date's year, month and day
// are each <= today's (compared independently, not as a whole date).
export function _isDueToday(st) {
  if (st.done || !st.due) return false;
  const today = new Date();
  const due = parseLocalDate(st.due);
  return due.getFullYear() <= today.getFullYear()
    && due.getMonth() <= today.getMonth()
    && due.getDate() <= today.getDate();
}

// Soonest due date among a task's incomplete subtasks, or null if none have one.
export function _getSoonestDueDate(task) {
  let soonest = null;
  for (const st of task.subtasks) {
    if (!st.due || st.done) continue;
    const d = parseLocalDate(st.due);
    if (soonest === null || d < soonest) soonest = d;
  }
  return soonest;
}
