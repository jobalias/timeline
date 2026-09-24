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