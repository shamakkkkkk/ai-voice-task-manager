// Date helpers that work on wall-clock strings ("YYYY-MM-DD" and "HH:mm").
// All arithmetic runs in UTC so it is immune to DST and to the server's time zone.

export const pad2 = (n) => String(n).padStart(2, '0');

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISODate(dt) {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISODate(parseISODate(s)) === s;
}

export function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function addDays(iso, n) {
  const dt = parseISODate(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISODate(dt);
}

export function addMonths(iso, n) {
  const dt = parseISODate(iso);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const daysInMonth = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, daysInMonth));
  return toISODate(dt);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(iso) {
  return parseISODate(iso).getUTCDay();
}

/** First date strictly after `iso` that falls on weekday `dow`. */
export function nextWeekday(iso, dow) {
  let diff = (dow - dayOfWeek(iso) + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(iso, diff);
}

export function diffDays(a, b) {
  return Math.round((parseISODate(a) - parseISODate(b)) / 86400000);
}

/** Adds minutes to a wall-clock moment, returns { date, time }. */
export function addMinutes(iso, hhmm, minutes) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm + minutes));
  return { date: toISODate(dt), time: `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}` };
}

/** Browser-side: today's date in the user's local time zone. */
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function localNowTime(d = new Date()) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Sort key: dated tasks first (by date, then time), undated last. */
export function compareDue(a, b) {
  const da = a.dueDate ?? '9999-99-99';
  const db = b.dueDate ?? '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  const ta = a.dueTime ?? '99:99';
  const tb = b.dueTime ?? '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return 0;
}
