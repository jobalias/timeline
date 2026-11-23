// Date helpers. Date strings are 'YYYY-MM-DD' (ymd) and times are 'HH:MM' (hhmm).

export const pad2 = (n) => String(n).padStart(2, '0');

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Local-time 'YYYY-MM-DD' (no UTC shift)
export function ymdLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Local-time 'HH:MM'
export function hhmm(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 'YYYY-MM-DD' → local midnight of that day
export function parseLocalDate(s) {
  return new Date(s + 'T00:00:00');
}

// 'YYYY-MM-DD' + 'HH:MM' → local Date
export function parseLocalDateTime(date, time) {
  const d = parseLocalDate(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

// Like parseLocalDate, but null for an empty value
export function parseYmd(s) {
  return s ? startOfDay(parseLocalDate(s)) : null;
}

// Same local calendar day?
export function sameDay(a, b) {
  return ymdLocal(a) === ymdLocal(b);
}

// 'Nov 14'
export function fmtShortDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
