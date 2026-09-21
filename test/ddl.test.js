import test from 'node:test';
import assert from 'node:assert/strict';
import { DDL } from '../db/ddl.js';

// node:sqlite ships with Node >= 22.5; on older Node the test is skipped.
let sqlite = null;
try {
  sqlite = await import('node:sqlite');
} catch {
  /* skipped below */
}

test('DDL creates the schema and is idempotent', { skip: !sqlite && 'node:sqlite is not available' }, () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.exec(DDL); // running twice must be harmless
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.deepEqual(cols('tasks'), ['id', 'user_id', 'title', 'done', 'done_at', 'created_at', 'due_date', 'due_time', 'priority', 'tags']);
  assert.deepEqual(cols('users'), ['id', 'created_at']);
  assert.deepEqual(cols('commands'), ['id', 'user_id', 'text', 'source', 'engine', 'model', 'ms', 'actions', 'created_at']);
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('u1', 1);
  db.prepare('INSERT INTO tasks (id, user_id, title, created_at) VALUES (?, ?, ?, ?)').run('t1', 'u1', 'x', 1);
  const row = db.prepare('SELECT done, priority, tags FROM tasks WHERE id = ?').get('t1');
  assert.deepEqual({ ...row }, { done: 0, priority: 'normal', tags: '[]' });
  db.close();
});
