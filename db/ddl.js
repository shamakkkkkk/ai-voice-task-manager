// Idempotent schema bootstrap. Runs once per process on first database access, so the app works on a
// brand-new SQLite file / Turso database with zero manual steps. Kept in sync with db/schema.js
// (a test compares both). For real migrations use drizzle-kit: `npm run db:generate`.
export const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER,
  created_at INTEGER NOT NULL,
  due_date TEXT,
  due_time TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  tags TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id);
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  engine TEXT NOT NULL,
  model TEXT,
  ms INTEGER,
  actions INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS commands_user_idx ON commands (user_id, created_at);
`;
