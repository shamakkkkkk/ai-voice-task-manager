// Integration test of the real Drizzle + libSQL layer against a temporary SQLite file.
// It runs automatically once dependencies are installed (`npm install && npm test`).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-db-'));
process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;

let mods = null;
try {
  mods = {
    client: await import('../db/client.js'),
    repo: await import('../db/repo.js'),
    schema: await import('../db/schema.js'),
    orm: await import('drizzle-orm'),
  };
} catch {
  /* dependencies not installed: skipped below */
}
const skip = !mods && 'run `npm install` to enable the database tests';

const task = (id, over = {}) => ({ id, title: id, done: false, doneAt: null, createdAt: Date.now(), dueDate: null, dueTime: null, priority: 'normal', tags: [], ...over });

test('schema.js matches the SQL that creates the tables', { skip }, async () => {
  const { client } = await mods.client.getConnection();
  for (const [name, table] of [['tasks', mods.schema.tasks], ['users', mods.schema.users], ['commands', mods.schema.commands]]) {
    const info = await client.execute(`PRAGMA table_info(${name})`);
    const inDb = info.rows.map((r) => r.name).sort();
    const inSchema = Object.values(mods.orm.getTableColumns(table)).map((c) => c.name).sort();
    assert.deepEqual(inSchema, inDb, name);
  }
});

test('repo: insert, update, delete in one transaction and read back', { skip }, async () => {
  const repo = await mods.repo.getRepo();
  await repo.ensureUser('u1');
  await repo.ensureUser('u1'); // idempotent
  await repo.saveChanges('u1', { inserts: [task('a', { tags: ['home'], dueDate: '2026-09-19', dueTime: '17:00', priority: 'high' }), task('b')] });
  let rows = await repo.listTasks('u1');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].tags, ['home']);
  assert.equal(rows[0].dueTime, '17:00');
  assert.equal(rows[0].done, false);

  await repo.saveChanges('u1', { updates: [{ ...rows[0], done: true, doneAt: 5 }], deleteIds: ['b'] });
  rows = await repo.listTasks('u1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].done, true);
  assert.equal(rows[0].doneAt, 5);
});

test('repo: rows are scoped to their owner and failed transactions roll back', { skip }, async () => {
  const repo = await mods.repo.getRepo();
  await repo.ensureUser('u2');
  await repo.ensureUser('u3');
  await repo.saveChanges('u2', { inserts: [task('mine')] });
  await repo.saveChanges('u3', { updates: [task('mine', { title: 'hacked' })], deleteIds: ['mine'] });
  assert.equal((await repo.listTasks('u2'))[0].title, 'mine');
  await assert.rejects(() => repo.saveChanges('u3', { inserts: [task('fresh'), task('mine')] })); // duplicate primary key
  assert.equal((await repo.listTasks('u3')).length, 0, 'the insert of "fresh" must be rolled back too');
});

test('repo: command log', { skip }, async () => {
  const repo = await mods.repo.getRepo();
  await repo.ensureUser('u4');
  await repo.logCommand('u4', { text: 'hello', source: 'voice', engine: 'local', model: null, ms: 12, actions: 1 });
  const { client } = await mods.client.getConnection();
  const res = await client.execute({ sql: 'SELECT text, source, actions FROM commands WHERE user_id = ?', args: ['u4'] });
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].text, 'hello');
});
