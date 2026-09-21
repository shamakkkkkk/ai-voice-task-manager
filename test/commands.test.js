import test from 'node:test';
import assert from 'node:assert/strict';
import { applyActions, groupOpen } from '../lib/commands.js';
import { findTask } from '../lib/nlu/match.js';
import { addDays, addMonths, nextWeekday, dayOfWeek } from '../lib/dates.js';

let n = 0;
const idFactory = () => `id${++n}`;
const base = [
  { id: 'a', title: 'Купить молоко', done: false, doneAt: null, createdAt: 1, dueDate: null, dueTime: null, priority: 'normal', tags: [] },
  { id: 'b', title: 'Send report', done: false, doneAt: null, createdAt: 2, dueDate: '2026-09-18', dueTime: '10:00', priority: 'high', tags: [] },
];

test('add / complete / delete in one command', () => {
  const { tasks, summary } = applyActions(
    base,
    [
      { type: 'add', title: 'Позвонить маме', dueDate: '2026-09-19', dueTime: '17:00', priority: 'normal', tags: [] },
      { type: 'complete', taskId: 'a', query: null },
      { type: 'delete', taskId: null, query: 'report' },
      { type: 'complete', taskId: null, query: 'самолёт' },
    ],
    { now: 100, idFactory },
  );
  assert.equal(summary.added.length, 1);
  assert.equal(summary.completed[0].id, 'a');
  assert.equal(summary.deleted[0].id, 'b');
  assert.deepEqual(summary.missed, ['самолёт']);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.find((t) => t.id === 'a').done);
});

test('input array is not mutated (undo relies on it)', () => {
  const snapshot = JSON.stringify(base);
  applyActions(base, [{ type: 'delete', taskId: 'a', query: null }], { idFactory });
  assert.equal(JSON.stringify(base), snapshot);
});

test('groupOpen buckets by due date', () => {
  const tasks = [
    ...base,
    { ...base[0], id: 'c', dueDate: '2026-09-17' },
    { ...base[0], id: 'd', dueDate: '2026-09-19' },
    { ...base[0], id: 'e', dueDate: '2026-10-01' },
  ];
  const g = groupOpen(tasks, '2026-09-18', '2026-09-19');
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((t) => t.id)])), {
    overdue: ['c'], today: ['b'], tomorrow: ['d'], later: ['e'], someday: ['a'],
  });
});

test('findTask: inflection, threshold, newest', () => {
  assert.equal(findTask(base, 'молока')?.id, 'a');
  assert.equal(findTask(base, 'reports')?.id, 'b');
  assert.equal(findTask(base, 'самолёт'), null);
  assert.equal(findTask(base, 'last')?.id, 'b');
});

test('date math is DST-proof and clamps months', () => {
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(dayOfWeek(nextWeekday('2026-09-18', 5)), 5);
  assert.equal(nextWeekday('2026-09-18', 5), '2026-09-25');
});
