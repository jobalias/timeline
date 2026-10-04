export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function ymd(d) {
  return startOfDay(d).toISOString().slice(0, 10);
}

export function parseYmd(s) {
  return s ? startOfDay(new Date(s + 'T00:00:00')) : null;
}

export function sameDay(a, b) {
  return ymd(a) === ymd(b);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function _isDueToday(st) {
  if (st.done || !st.due) {
    return false;
  }
  const today = new Date();
  const due = new Date(st.due + 'T00:00:00');
  if (due.getFullYear() > today.getFullYear()) return false;
  if (due.getMonth() > today.getMonth()) return false;
  if (due.getDate() > today.getDate()) return false;
  return true;
}

  // Returns the soonest due date among a task's subtasks as a Date object,
  // or null if no subtasks have due dates
export function _getSoonestDueDate(task) {
  let soonest = null;
  task.subtasks.forEach((st) => {
    if (!st.due || st.done) return;
    const d = new Date(st.due + 'T00:00:00');
    if (soonest === null || d < soonest) {
      soonest = d;
    }
  });
  return soonest;
}