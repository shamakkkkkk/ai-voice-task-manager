// Offline natural-language parser (Russian + English).
// It is the safety net of the app: if the LLM is unreachable, rate-limited or not configured,
// voice commands still turn into structured tasks. It also runs in the browser.
//
// Input : a phrase, today's date, the current time, the user's open tasks.
// Output: [{ type: 'add' | 'complete' | 'delete', ... }]  (same shape the LLM returns)

import { addDays, addMinutes, addMonths, dayOfWeek, isValidDate, nextWeekday, pad2 } from '../dates.js';
import { findTask } from './match.js';

// ── regex helpers ────────────────────────────────────────────────────────────
// \b does not understand Cyrillic, so word boundaries are spelled out with Unicode classes.
const L = '(?<![\\p{L}\\p{N}_])';
const R = '(?![\\p{L}\\p{N}_])';
const rx = (src, flags = 'iu') => new RegExp(src, flags);
const wrap = (src, flags = 'iu') => rx(`${L}(?:${src})${R}`, flags);
const longestFirst = (words) => [...words].sort((a, b) => b.length - a.length).join('|');

function take(text, re) {
  const m = re.exec(text);
  if (!m) return { m: null, rest: text };
  return { m, rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}` };
}

// ── vocabulary ───────────────────────────────────────────────────────────────
const NUMWORDS = {
  один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8,
  девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, пятнадцать: 15, двадцать: 20, тридцать: 30,
  сорок: 40, пятьдесят: 50,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const NUM = `\\d{1,3}|${longestFirst(Object.keys(NUMWORDS))}`;
const toNum = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : NUMWORDS[s.toLowerCase()]);

const MONTHS = [
  ['январ[яьеи]', 'jan(?:uary)?'], ['феврал[яьеи]', 'feb(?:ruary)?'], ['март[аеу]?', 'mar(?:ch)?'],
  ['апрел[яьеи]', 'apr(?:il)?'], ['ма[яйе]', 'may'], ['июн[яьеи]', 'june?'], ['июл[яьеи]', 'july?'],
  ['август[аеу]?', 'aug(?:ust)?'], ['сентябр[яьеи]', 'sep(?:t(?:ember)?)?'], ['октябр[яьеи]', 'oct(?:ober)?'],
  ['ноябр[яьеи]', 'nov(?:ember)?'], ['декабр[яьеи]', 'dec(?:ember)?'],
];
const MONTH_ALT = MONTHS.flatMap(([ru, en]) => [ru, en]).join('|');
const MONTH_TESTS = MONTHS.map(([ru, en]) => rx(`^(?:${ru}|${en})$`));
const monthIndex = (s) => MONTH_TESTS.findIndex((re) => re.test(s)); // 0-based

const WEEKDAY_ALT =
  'понедельник\\p{L}*|вторник\\p{L}*|сред[уаы]|четверг\\p{L}*|пятниц\\p{L}*|суббот\\p{L}*|воскресень\\p{L}*|' +
  'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const WEEKDAY_TESTS = [
  [/^(воскр|sun)/i, 0], [/^(понед|mon)/i, 1], [/^(вторн|tue)/i, 2], [/^(сред|wed)/i, 3],
  [/^(четв|thu)/i, 4], [/^(пятн|fri)/i, 5], [/^(субб|sat)/i, 6],
];
const weekdayIndex = (s) => WEEKDAY_TESTS.find(([re]) => re.test(s))[1];

// ── normalisation and splitting ──────────────────────────────────────────────
function normalize(text) {
  return String(text)
    .replace(/\b([ap])\.m\.?/gi, '$1m')
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const SPLIT = rx(
  `(?:\\s*[.;!?]+\\s+|\\s+(?:и\\s+ещ[её]|а\\s+ещ[её]|а\\s+также|потом|затем|после\\s+этого|плюс|and\\s+also|and\\s+then|also|then|plus)${R}\\s*|\\s+(?:и|and)\\s+(?=(?:удали|убери|сотри|отмени|выкинь|отметь|заверши|закрой|вычеркни|напомни|добавь|запиши|delete|remove|cancel|mark|check\\s+off|remind|add)${R}))`,
  'giu',
);

function splitSegments(text) {
  return text
    .split(SPLIT)
    .map((s) => s.replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, ''))
    .filter((s) => s.length > 1);
}

// ── intents: complete / delete ───────────────────────────────────────────────
// Imperatives that are unambiguous ("отметь", "удали") always count as commands.
// Verbs that double as task titles in English ("delete old files") only count when they match an existing task.
const COMPLETE_STRONG = [
  rx('^(?:(?:пожалуйста|please)[,\\s]+)?(?:отметь|выполни|заверши|закрой|вычеркни|зачеркни|(?:я\\s+)?(?:сделал|сделала|закончил|закончила|выполнил|выполнила)|check\\s+off|tick\\s+off|cross\\s+off|done\\s+with|i(?:\'ve|\\s+have)?\\s+(?:finished|completed|done))(?![\\p{L}\\p{N}_])[\\s,:-]*'),
  rx('^(?:please\\s+)?mark(?![\\p{L}\\p{N}_])(?=.*(?<![\\p{L}\\p{N}_])(?:done|complete|completed|finished)(?![\\p{L}\\p{N}_]))[\\s,:-]*'),
];
const COMPLETE_WEAK = rx('^(?:please\\s+)?(?:complete|finish|done)(?![\\p{L}\\p{N}_])[\\s,:-]*');
const DELETE_STRONG = [
  rx('^(?:(?:пожалуйста|please)[,\\s]+)?(?:удали|убери|сотри|отмени|выкинь)(?![\\p{L}\\p{N}_])[\\s,:-]*'),
  rx('^(?:please\\s+)?(?:delete|remove|cancel|drop)\\s+(?:the\\s+|my\\s+)?(?:task|reminder)(?![\\p{L}\\p{N}_])[\\s,:-]*'),
];
const DELETE_WEAK = rx('^(?:please\\s+)?(?:delete|remove|cancel|drop|discard)(?![\\p{L}\\p{N}_])[\\s,:-]*');

const QUERY_JUNK = [
  wrap('(?:как\\s+)?(?:выполненн\\p{L}+|сделанн\\p{L}+|завершенн\\p{L}+)', 'giu'),
  wrap('(?:as\\s+)?(?:done|complete|completed|finished)', 'giu'),
];
const QUERY_LEAD = rx(
  `^[\\s,.:;-]*(?:${longestFirst(['задачу', 'задача', 'задачи', 'таск', 'напоминание', 'про', 'о', 'об', 'the', 'my', 'task', 'reminder', 'called', 'named', 'a', 'мою', 'эту'])})(?![\\p{L}\\p{N}_])[\\s,.:;-]*`,
);

function cleanQuery(s) {
  let q = s;
  for (const re of QUERY_JUNK) q = q.replace(re, ' ');
  let prev;
  do {
    prev = q;
    q = q.replace(QUERY_LEAD, '');
  } while (q !== prev);
  return q.replace(/\s+/g, ' ').replace(/[\s,.;:!?-]+$/g, '').trim();
}

function detectIntent(seg, tasks) {
  const table = [
    ['complete', COMPLETE_STRONG, COMPLETE_WEAK],
    ['delete', DELETE_STRONG, DELETE_WEAK],
  ];
  for (const [type, strongList, weak] of table) {
    for (const strong of strongList) {
      const m = strong.exec(seg);
      if (m) {
        const query = cleanQuery(seg.slice(m[0].length));
        return { type, title: null, dueDate: null, dueTime: null, priority: null, tags: [], taskId: findTask(tasks, query)?.id ?? null, query };
      }
    }
    const m = weak.exec(seg);
    if (m) {
      const query = cleanQuery(seg.slice(m[0].length));
      const hit = findTask(tasks, query);
      if (hit) return { type, title: null, dueDate: null, dueTime: null, priority: null, tags: [], taskId: hit.id, query };
    }
  }
  return null;
}

// ── extractors for "add" ─────────────────────────────────────────────────────
const TAG_HASH = rx('(?<![\\p{L}\\p{N}])#([\\p{L}\\p{N}_-]{1,24})');
const TAG_WORD = rx(`${L}(?:тег|тэг|метка|метку|tag|label)\\s+([\\p{L}\\p{N}_-]{1,24})${R}`);

const PRIORITY_LOW = wrap(
  '(?:с\\s+)?(?:низк\\p{L}+\\s+приоритет\\p{L}*|не\\s+срочно|не\\s+важно|неважно|когда\\s+будет\\s+время|без\\s+спешки|low\\s+priority|not\\s+urgent|no\\s+rush|whenever|someday)',
);
const PRIORITY_HIGH = wrap(
  '(?:с\\s+)?(?:высок\\p{L}+\\s+приоритет\\p{L}*|очень\\s+важно|очень\\s+срочно|срочно|срочная|срочный|срочное|важно|важная|важный|важное|критично|high\\s+priority|top\\s+priority|urgently|urgent|asap|important|critical)',
);

const DURATION = rx(
  `${L}(?:через|in)\\s+(?:(полчаса|half\\s+an\\s+hour|an?\\s+hour|час|неделю|день|месяц|an?\\s+(?:day|week|month))|(${NUM})\\s*(минут\\p{L}*|мин|minutes?|mins?|час\\p{L}*|hours?|hrs?|дн\\p{L}*|день|days?|недел\\p{L}*|weeks?|месяц\\p{L}*|months?))${R}`,
);

function unitOf(u) {
  const s = u.toLowerCase();
  if (/^(мин|min)/.test(s)) return 'minute';
  if (/^(час|hour|hr)/.test(s)) return 'hour';
  if (/^(дн|ден|day)/.test(s)) return 'day';
  if (/^(нед|week)/.test(s)) return 'week';
  return 'month';
}

function extractDuration(text, { today, now }) {
  const { m, rest } = take(text, DURATION);
  if (!m) return null;
  let n;
  let unit;
  if (m[1]) {
    const w = m[1].toLowerCase();
    if (/полчаса|half/.test(w)) { n = 30; unit = 'minute'; }
    else { n = 1; unit = unitOf(w.replace(/^an?\s+/, '')); }
  } else {
    n = toNum(m[2]);
    unit = unitOf(m[3]);
  }
  if (!n) return null;
  if (unit === 'minute' || unit === 'hour') {
    const r = addMinutes(today, now, unit === 'hour' ? n * 60 : n);
    return { rest, date: r.date, time: r.time };
  }
  const date = unit === 'day' ? addDays(today, n) : unit === 'week' ? addDays(today, n * 7) : addMonths(today, n);
  return { rest, date, time: null };
}

const DATE_DM = rx(
  `${L}(?:(?:на|к|до|в|on|by|before|until)\\s+)?(\\d{1,2})(?:-?(?:го|st|nd|rd|th))?\\s+(?:of\\s+)?(${MONTH_ALT})(?:\\s+(\\d{4}))?${R}`,
);
const DATE_MD = rx(
  `${L}(?:(?:on|by|before|until)\\s+)?(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${R}`,
);
const DATE_DAYNUM = rx(
  `${L}(?:(?:на|к|до|в|on|by)\\s+)?(?:the\\s+)?(\\d{1,2})(?:-?(?:го|st|nd|rd|th))?\\s+(?:числа|of\\s+the\\s+month)${R}`,
);

function extractCalendarDate(text, { today }) {
  const year = +today.slice(0, 4);
  const build = (y, mon, d, explicitYear) => {
    let iso = `${y}-${pad2(mon + 1)}-${pad2(d)}`;
    if (!isValidDate(iso)) return null;
    if (!explicitYear && iso < today) iso = `${y + 1}-${pad2(mon + 1)}-${pad2(d)}`;
    return isValidDate(iso) ? iso : null;
  };

  let r = take(text, DATE_DM);
  if (r.m) {
    const date = build(r.m[3] ? +r.m[3] : year, monthIndex(r.m[2]), +r.m[1], !!r.m[3]);
    if (date) return { rest: r.rest, date };
  }
  r = take(text, DATE_MD);
  if (r.m) {
    const date = build(r.m[3] ? +r.m[3] : year, monthIndex(r.m[1]), +r.m[2], !!r.m[3]);
    if (date) return { rest: r.rest, date };
  }
  r = take(text, DATE_DAYNUM);
  if (r.m) {
    const day = +r.m[1];
    const month = +today.slice(5, 7) - 1;
    let date = build(year, month, day, true);
    if (date && date < today) date = build(month === 11 ? year + 1 : year, (month + 1) % 12, day, true);
    if (date) return { rest: r.rest, date };
  }
  return null;
}

// Time of day ------------------------------------------------------------------
const TIME_HM = rx(
  `${L}(?:(?:в|к|около|at|by|around|@)\\s*)?(\\d{1,2}):(\\d{2})(?:\\s*(am|pm|утра|вечера|дня|ночи))?${R}`,
);
const TIME_H_QUAL = rx(
  `${L}(?:в|к|около|at|by|around)\\s+(${NUM})\\s*(?:часов|часа|час|o'clock)?\\s*(утра|вечера|дня|ночи|am|pm)${R}`,
);
const TIME_H_AMPM = rx(`${L}(\\d{1,2})\\s*(am|pm)${R}`);
const TIME_NOON = rx(`${L}(?:(?:в|at)\\s+)?(полдень|полночь|noon|midnight)${R}`);
const UNIT_WORDS = 'раз|раза|штук|шт|числа|минут|мин|дней|дня|день|недель|недели|месяц|месяца|год|года|лет|процентов|процента|кг|литров|рублей|долларов|евро|человек|times|items|people|pcs|minutes|mins|days|weeks|months|years|dollars|bucks|kg|lbs|percent';
const TIME_H_BARE = rx(
  `${L}(?:в|к|at|by|около|around)\\s+(\\d{1,2})(?:\\s*(?:часов|часа|час|o'clock))?${R}(?!\\s*(?:${UNIT_WORDS})${R})(?!\\s*[:.]\\d)`,
);
const PART_OF_DAY = [
  { re: rx(`${L}(?:(?:в|во)\\s+)?(утром|с\\s+утра)${R}`), time: '09:00' },
  { re: rx(`${L}(?:(?:в|во)\\s+)?(дн[её]м)${R}`), time: '14:00' },
  { re: rx(`${L}(?:(?:в|во)\\s+)?(вечером)${R}`), time: '19:00' },
  { re: rx(`${L}(?:(?:в|во)\\s+)?(ночью)${R}`), time: '22:00' },
  { re: rx(`${L}(?:in\\s+the|this)\\s+(morning)${R}`), time: '09:00' },
  { re: rx(`${L}(?:in\\s+the|this)\\s+(afternoon)${R}`), time: '14:00' },
  { re: rx(`${L}(?:in\\s+the|this)\\s+(evening)${R}`), time: '19:00' },
  { re: rx(`(?<=(?:tomorrow|today)\\s+)(morning)${R}`), time: '09:00' },
  { re: rx(`(?<=(?:tomorrow|today)\\s+)(afternoon)${R}`), time: '14:00' },
  { re: rx(`(?<=(?:tomorrow|today)\\s+)(evening)${R}`), time: '19:00' },
  { re: rx(`(?<=(?:tomorrow|today)\\s+)(night)${R}`), time: '22:00' },
  { re: wrap('tonight|этим\\s+вечером'), time: '20:00' },
];

function to24(h, q) {
  const s = q?.toLowerCase();
  if (s === 'am' || s === 'утра') return h === 12 ? 0 : h;
  if (s === 'pm' || s === 'вечера' || s === 'дня') return h < 12 ? h + 12 : h;
  if (s === 'ночи') return h === 12 ? 0 : h >= 8 ? h + 12 : h;
  return h;
}
const hhmm = (h, m) => `${pad2(h)}:${pad2(m)}`;

function extractTime(text) {
  let r = take(text, TIME_HM);
  if (r.m) {
    const h = +r.m[1];
    const mi = +r.m[2];
    const q = r.m[3];
    if (mi <= 59 && (q ? h >= 1 && h <= 12 : h <= 23)) return { rest: r.rest, time: hhmm(to24(h, q), mi) };
  }
  r = take(text, TIME_H_QUAL);
  if (r.m) {
    const h = toNum(r.m[1]);
    if (h >= 1 && h <= 12) return { rest: r.rest, time: hhmm(to24(h, r.m[2]), 0) };
  }
  r = take(text, TIME_H_AMPM);
  if (r.m) {
    const h = +r.m[1];
    if (h >= 1 && h <= 12) return { rest: r.rest, time: hhmm(to24(h, r.m[2]), 0) };
  }
  r = take(text, TIME_NOON);
  if (r.m) return { rest: r.rest, time: /noon|полдень/i.test(r.m[1]) ? '12:00' : '00:00' };
  for (const { re, time } of PART_OF_DAY) {
    r = take(text, re);
    if (r.m) return { rest: r.rest, time };
  }
  r = take(text, TIME_H_BARE);
  if (r.m) {
    const h = +r.m[1];
    if (h >= 0 && h <= 23) return { rest: r.rest, time: hhmm(h >= 1 && h <= 6 ? h + 12 : h, 0) }; // "at 5" means 17:00
  }
  return null;
}

// Relative dates ---------------------------------------------------------------
const REL_WEEKDAY_RU = rx(
  `${L}(?:(?:в|во|на|к|до)\\s+)?(?:(?:следующ\\p{L}+|эт\\p{L}+|ближайш\\p{L}+)\\s+)?(${WEEKDAY_ALT.split('|').slice(0, 7).join('|')})${R}`,
);
const REL_WEEKDAY_EN = rx(`${L}(?:(?:on|by|next|this|before|until)\\s+)*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)${R}`);
const REL_AFTER_TOMORROW = wrap('(?:на\\s+)?послезавтра|day\\s+after\\s+tomorrow');
const REL_TOMORROW = wrap('(?:на\\s+)?завтра(?:шний\\s+день)?|tomorrow');
const REL_TODAY = wrap('(?:на\\s+)?сегодня(?:шний\\s+день)?|today|tonight');
const REL_WEEKEND = wrap('(?:(?:на|в)\\s+)?(?:эти\\s+)?выходн\\p{L}+|(?:this\\s+|on\\s+the\\s+)?weekend');
const REL_NEXT_WEEK = wrap('(?:на|в)\\s+следующей\\s+неделе|на\\s+той\\s+неделе|next\\s+week');

function extractRelativeDate(text, { today }) {
  let date = null;
  let rest = text;
  const steps = [
    [REL_WEEKDAY_RU, (m) => nextWeekday(today, weekdayIndex(m[1]))],
    [REL_WEEKDAY_EN, (m) => nextWeekday(today, weekdayIndex(m[1]))],
    [REL_AFTER_TOMORROW, () => addDays(today, 2)],
    [REL_TOMORROW, () => addDays(today, 1)],
    [REL_TODAY, () => today],
    [REL_WEEKEND, () => (dayOfWeek(today) === 6 || dayOfWeek(today) === 0 ? today : nextWeekday(today, 6))],
    [REL_NEXT_WEEK, () => nextWeekday(today, 1)],
  ];
  let found = false;
  for (const [re, fn] of steps) {
    const r = take(rest, re);
    if (r.m) {
      found = true;
      rest = r.rest;
      if (!date) date = fn(r.m);
    }
  }
  return found ? { rest, date } : null;
}

// ── title cleanup ────────────────────────────────────────────────────────────
const LEAD_WORDS = [
  'пожалуйста', 'please', 'слушай', 'окей', 'ок', 'ну', 'так', 'итак', 'hey', 'давай', 'давайте', 'мне',
  'нужно бы', 'нужно', 'надо бы', 'надо', 'необходимо', 'не забыть', 'не забудь', 'не забудьте', 'хочу',
  'напомни мне', 'напомни', 'напомнить', 'напоминание', 'добавь мне', 'добавь', 'добавить', 'создай', 'создать',
  'запиши', 'записать', 'поставь', 'поставить', 'занеси', 'новую задачу', 'новая задача', 'задачу', 'задача', 'таск',
  'в список дел', 'в список', 'в задачи', 'to my todo list', 'to my list', 'to the list', 'to my tasks',
  'new task', 'task', 'todo', 'to-do', 'add', 'create', 'remind me to', 'remind me', 'remember to', 'i need to',
  'i have to', 'i must', 'i want to', "don't forget to", 'dont forget to', 'need to', 'have to', 'to', 'и', 'а', 'and',
  'что', 'о том, что', 'о том', 'что нужно', 'потом', 'затем', 'еще', 'ещё', 'also', 'then',
];
const LEAD = rx(`^[\\s,.:;!?-]*(?:${longestFirst(LEAD_WORDS)})(?![\\p{L}\\p{N}_])[\\s,.:;!?-]*`);
const TRAIL_FILLER = rx(
  `[\\s,.:;!?-]*(?:в\\s+список\\s+дел|в\\s+список|в\\s+задачи|to\\s+my\\s+(?:todo\\s+)?list|to\\s+the\\s+list|to\\s+my\\s+tasks|пожалуйста|please)[\\s,.:;!?-]*$`,
);
const TRAIL_DANGLING = rx(
  `(?:^|\\s)(?:в|во|на|к|до|по|с|со|и|а|около|at|on|by|in|for|to|the|around|before|after|until|and|or)[\\s,.:;!?-]*$`,
);

function cleanTitle(raw) {
  let s = raw.replace(/\s+/g, ' ');
  let prev;
  do {
    prev = s;
    s = s.replace(LEAD, '').replace(TRAIL_FILLER, '').replace(TRAIL_DANGLING, '');
  } while (s !== prev);
  s = s.replace(/\s+([,.;:!?])/g, '$1').replace(/[\s,.;:!?-]+$/g, '').replace(/^["'\s-]+|["'\s]+$/g, '').trim();
  if (s.length > 120) s = `${s.slice(0, 117).trimEnd()}…`;
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// ── "add" ────────────────────────────────────────────────────────────────────
function parseAdd(seg, { today, now }) {
  let text = seg;
  const tags = [];

  for (const re of [TAG_HASH, TAG_WORD]) {
    let r;
    while ((r = take(text, re)).m) {
      tags.push(r.m[1].toLowerCase());
      text = r.rest;
    }
  }

  let priority = 'normal';
  let r = take(text, PRIORITY_LOW);
  if (r.m) { priority = 'low'; text = r.rest; }
  r = take(text, PRIORITY_HIGH);
  if (r.m) { if (priority === 'normal') priority = 'high'; text = r.rest; }

  let date = null;
  let time = null;

  const dur = extractDuration(text, { today, now });
  if (dur) { text = dur.rest; date = dur.date; time = dur.time; }

  const cal = extractCalendarDate(text, { today });
  if (cal) { text = cal.rest; date = date ?? cal.date; }

  if (!time) {
    const t = extractTime(text);
    if (t) { text = t.rest; time = t.time; }
  }

  const rel = extractRelativeDate(text, { today });
  if (rel) { text = rel.rest; date = date ?? rel.date; }

  if (!date && time) date = time > now ? today : addDays(today, 1);

  const title = cleanTitle(text) || cleanTitle(seg);
  if (!title) return null;
  return {
    type: 'add',
    title,
    dueDate: date,
    dueTime: date ? time : null,
    priority,
    tags: [...new Set(tags)].slice(0, 3),
    taskId: null,
    query: null,
  };
}

// ── public API ───────────────────────────────────────────────────────────────
/**
 * @param {{ text: string, today: string, now?: string, tasks?: {id:string,title:string}[] }} input
 */
export function parseCommandLocal({ text, today, now = '09:00', tasks = [] }) {
  if (!isValidDate(today)) throw new Error('parseCommandLocal: "today" must be YYYY-MM-DD');
  const actions = [];
  for (const seg of splitSegments(normalize(text))) {
    const action = detectIntent(seg, tasks) ?? parseAdd(seg, { today, now });
    if (action) actions.push(action);
  }
  return actions;
}
