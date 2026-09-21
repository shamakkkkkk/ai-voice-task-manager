// Pure functions that apply NLU actions to a task list. No React, no I/O — easy to test.
import { findTask } from './nlu/match.js';
import { compareDue } from './dates.js';

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

export function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {object[]} tasks current tasks
 * @param {object[]} actions validated actions from any engine
 * @returns {{ tasks: object[], summary: { added: object[], completed: object[], deleted: object[], missed: string[] } }}
 */
export function applyActions(tasks, actions, { now = Date.now(), idFactory = makeId } = {}) {
  let next = tasks.slice();
  const summary = { added: [], completed: [], deleted: [], missed: [] };

  const resolve = (action, pool) => {
    if (action.taskId) {
      const byId = pool.find((t) => t.id === action.taskId);
      if (byId) return byId;
    }
    return action.query ? findTask(pool, action.query) : null;
  };

  for (const a of actions) {
    if (a.type === 'add') {
      const task = {
        id: idFactory(),
        title: a.title,
        done: false,
        doneAt: null,
        createdAt: now + summary.added.length, // keeps creation order stable inside one command
        dueDate: a.dueDate ?? null,
        dueTime: a.dueDate ? a.dueTime ?? null : null,
        priority: a.priority ?? 'normal',
        tags: a.tags ?? [],
      };
      next.push(task);
      summary.added.push(task);
    } else if (a.type === 'complete') {
      const hit = resolve(a, next.filter((t) => !t.done));
      if (!hit) {
        summary.missed.push(a.query || '');
        continue;
      }
      const done = { ...hit, done: true, doneAt: now };
      next = next.map((t) => (t.id === hit.id ? done : t));
      summary.completed.push(done);
    } else if (a.type === 'delete') {
      const hit = resolve(a, next.filter((t) => !t.done)) ?? resolve(a, next);
      if (!hit) {
        summary.missed.push(a.query || '');
        continue;
      }
      next = next.filter((t) => t.id !== hit.id);
      summary.deleted.push(hit);
    }
  }
  return { tasks: next, summary };
}

/** Open tasks first (soonest due, then priority), used for the main list. */
export function sortOpen(tasks) {
  return [...tasks].sort(
    (a, b) => compareDue(a, b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt,
  );
}

/** Groups open tasks into overdue / today / tomorrow / later / someday buckets. */
export function groupOpen(tasks, today, tomorrow) {
  const groups = { overdue: [], today: [], tomorrow: [], later: [], someday: [] };
  for (const t of sortOpen(tasks.filter((x) => !x.done))) {
    if (!t.dueDate) groups.someday.push(t);
    else if (t.dueDate < today) groups.overdue.push(t);
    else if (t.dueDate === today) groups.today.push(t);
    else if (t.dueDate === tomorrow) groups.tomorrow.push(t);
    else groups.later.push(t);
  }
  return groups;
}

export function doneTasks(tasks) {
  return tasks.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
}
