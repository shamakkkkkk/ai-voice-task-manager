import { diffDays, parseISODate } from './dates.js';

/** "Today", "Tomorrow", "Fri, Sep 25" — always relative to the user's local `today`. */
export function dayLabel(iso, today, s) {
  const d = diffDays(iso, today);
  if (d === 0) return s.today;
  if (d === 1) return s.tomorrow;
  if (d === -1) return s.yesterday;
  const fmt = new Intl.DateTimeFormat(s.intl, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return fmt.format(parseISODate(iso));
}

/** "Tomorrow, 17:00" or "" when the task has no due date. */
export function dueText(task, today, s, { lower = false } = {}) {
  if (!task.dueDate) return '';
  let out = dayLabel(task.dueDate, today, s);
  if (task.dueTime) out += `, ${task.dueTime}`;
  // Only "Today"/"Tomorrow" read naturally in lower case mid-sentence; "Fri, Sep 25" must keep its capital.
  const relative = [s.today, s.tomorrow, s.yesterday].includes(dayLabel(task.dueDate, today, s));
  return lower && relative ? out.charAt(0).toLowerCase() + out.slice(1) : out;
}

/** "claude-haiku-4-5-20251001" → "Claude Haiku 4.5" */
export function modelLabel(engine, model, s) {
  if (engine === 'local') return s.localEngine;
  if (engine === 'realtime') return model ? `OpenAI Realtime ${model}` : 'OpenAI Realtime';
  if (engine === 'anthropic') {
    const m = /^claude-(?:(opus|sonnet|haiku)-)?(\d+)(?:-(\d))?(?:-(opus|sonnet|haiku))?/.exec(model || '');
    if (m) {
      const family = m[1] || m[4] || '';
      const ver = m[3] ? `${m[2]}.${m[3]}` : m[2];
      return `Claude ${family ? family[0].toUpperCase() + family.slice(1) + ' ' : ''}${ver}`.trim();
    }
    return 'Claude';
  }
  return model || 'OpenAI';
}

/** One human sentence per kind of change; used for the toast and the spoken reply. */
export function describeSummary(summary, today, s) {
  const lines = [];
  const { added, completed, deleted, missed } = summary;
  if (added.length) lines.push(s.added(added.length, added[0].title, dueText(added[0], today, s, { lower: true })));
  if (completed.length) lines.push(s.completed(completed.length, completed[0].title));
  if (deleted.length) lines.push(s.deleted(deleted.length, deleted[0].title));
  for (const q of missed) lines.push(s.missed(q));
  return lines;
}
