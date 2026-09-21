// Fuzzy matching of a spoken phrase ("the milk one") to an existing task.
// Works for Russian and English without a stemmer: two words match when they share a long enough prefix.

const STOP = new Set([
  'про', 'для', 'что', 'это', 'эту', 'мою', 'моя', 'мой', 'задачу', 'задача', 'задачи', 'таск', 'напоминание',
  'the', 'a', 'an', 'my', 'task', 'tasks', 'reminder', 'to', 'of', 'for', 'about', 'and', 'with',
]);
const NEWEST = new Set(['последнюю', 'последняя', 'последний', 'last', 'latest', 'newest', 'recent']);

export function tokenize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w)));
}

function similar(a, b) {
  if (a === b) return true;
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  return p >= Math.min(5, Math.max(3, max - 1));
}

/**
 * @param {{id:string,title:string,createdAt?:number}[]} tasks
 * @param {string} query
 * @returns {object|null} best matching task or null
 */
export function findTask(tasks, query) {
  const q = tokenize(query);
  if (!q.length || !tasks.length) return null;

  if (q.every((w) => NEWEST.has(w))) {
    return [...tasks].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  }

  let best = null;
  let bestScore = 0;
  for (const task of tasks) {
    const words = tokenize(task.title);
    if (!words.length) continue;
    const hits = q.filter((w) => words.some((tw) => similar(w, tw))).length;
    // Prefer tasks where the query covers more of the title.
    const score = hits / q.length + (hits / words.length) * 0.01;
    if (score > bestScore) {
      best = task;
      bestScore = score;
    }
  }
  return bestScore >= 0.6 ? best : null;
}
