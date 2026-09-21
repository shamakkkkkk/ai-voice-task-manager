import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskService, diffTasks, toolToActions } from '../lib/server/tasksService.js';
import { createMemoryRepo } from '../lib/server/memoryRepo.js';
import { parseCommand } from '../lib/nlu/llm.js';

const ctx = { today: '2026-09-18', now: '14:20', timezone: 'UTC', locale: 'en' };
const setup = () => {
  const repo = createMemoryRepo();
  const service = createTaskService({ repo, parse: (input) => parseCommand(input, { env: {} }) });
  return { repo, service };
};

test('command: phrase becomes persisted tasks and is logged', async () => {
  const { repo, service } = setup();
  const r = await service.command('u1', { ...ctx, text: 'buy milk tomorrow at 9am and call mom', source: 'voice' });
  assert.equal(r.tasks.length, 1); // "and" without a command verb stays one task
  assert.equal(r.tasks[0].title, 'Buy milk and call mom');
  assert.equal(r.summary.added.length, 1);
  assert.equal((await repo.listTasks('u1')).length, 1);
  assert.equal(repo.log[0].source, 'voice');
  assert.equal(repo.log[0].engine, 'local');
});

test('command: complete and delete resolve against stored tasks', async () => {
  const { service } = setup();
  await service.command('u1', { ...ctx, text: 'Купить молоко. Позвонить маме' });
  let r = await service.command('u1', { ...ctx, text: 'отметь купить молоко выполненной' });
  assert.equal(r.summary.completed.length, 1);
  assert.equal(r.tasks.filter((t) => t.done).length, 1);
  r = await service.command('u1', { ...ctx, text: 'удали задачу про маму' });
  assert.equal(r.summary.deleted.length, 1);
  assert.equal(r.tasks.length, 1);
});

test('users are isolated from each other', async () => {
  const { service } = setup();
  await service.command('alice', { ...ctx, text: 'buy milk' });
  assert.equal((await service.list('bob')).length, 0);
  const r = await service.command('bob', { ...ctx, text: 'delete buy milk' });
  assert.equal(r.summary.deleted.length, 0);
  assert.equal((await service.list('alice')).length, 1);
});

test('setDone / remove / clearDone', async () => {
  const { service } = setup();
  const { tasks } = await service.command('u', { ...ctx, text: 'one. two. three' });
  assert.equal(tasks.length, 3);
  const afterDone = await service.setDone('u', tasks[0].id, true);
  assert.ok(afterDone[0].done && afterDone[0].doneAt);
  assert.equal(await service.setDone('u', 'nope', true), null);
  assert.equal((await service.remove('u', tasks[1].id)).length, 2);
  assert.equal((await service.clearDone('u')).length, 1);
});

test('restore = undo: puts the list back to a snapshot', async () => {
  const { service } = setup();
  const first = await service.command('u', { ...ctx, text: 'buy milk' });
  const snapshot = first.tasks;
  await service.command('u', { ...ctx, text: 'delete buy milk' });
  assert.equal((await service.list('u')).length, 0);
  await service.restore('u', snapshot);
  assert.deepEqual((await service.list('u')).map((t) => t.title), ['Buy milk']);
});

test('restore refuses invalid snapshots and cannot steal another user\'s task id', async () => {
  const { service } = setup();
  const a = await service.command('alice', { ...ctx, text: 'secret plan' });
  await assert.rejects(() => service.restore('bob', [{ ...a.tasks[0], priority: 'urgent' }]));
  await assert.rejects(() => service.restore('bob', [a.tasks[0]])); // same id owned by alice → key conflict
  assert.equal((await service.list('alice')).length, 1);
});

test('realtime tools: add, list, complete, delete, errors', async () => {
  const { service } = setup();
  let r = await service.tool('u', { name: 'add_task', args: { title: 'call mom', due_date: '2026-09-19', due_time: '17:00', priority: 'high' }, ...ctx });
  assert.equal(r.output.ok, true);
  assert.equal(r.output.added[0].due, '2026-09-19 17:00');
  assert.equal(r.tasks.length, 1);

  r = await service.tool('u', { name: 'list_tasks', args: { scope: 'today' }, ...ctx });
  assert.equal(r.output.count, 0);
  r = await service.tool('u', { name: 'list_tasks', args: {}, ...ctx });
  assert.equal(r.output.count, 1);

  r = await service.tool('u', { name: 'complete_task', args: { query: 'mom' }, ...ctx });
  assert.equal(r.output.completed.length, 1);
  r = await service.tool('u', { name: 'delete_task', args: { query: 'submarine' }, ...ctx });
  assert.deepEqual(r.output.not_found, ['submarine']);

  r = await service.tool('u', { name: 'add_task', args: { title: '   ' }, ...ctx });
  assert.equal(r.output.ok, false);
  r = await service.tool('u', { name: 'launch_rocket', args: {}, ...ctx });
  assert.match(r.output.error, /unknown_tool/);
});

test('diffTasks only reports real changes', () => {
  const t = (id, title = id) => ({ id, title, done: false, doneAt: null, createdAt: 1, dueDate: null, dueTime: null, priority: 'normal', tags: [] });
  const d = diffTasks([t('a'), t('b'), t('c')], [t('a'), { ...t('b'), done: true }, t('d')]);
  assert.deepEqual([d.inserts.map((x) => x.id), d.updates.map((x) => x.id), d.deleteIds], [['d'], ['b'], ['c']]);
});

test('toolToActions maps every tool', () => {
  assert.equal(toolToActions('add_task', { title: 'x' })[0].type, 'add');
  assert.equal(toolToActions('complete_task', { query: 'x' })[0].type, 'complete');
  assert.equal(toolToActions('delete_task', { task_id: 'i' })[0].taskId, 'i');
  assert.equal(toolToActions('nope'), null);
});
