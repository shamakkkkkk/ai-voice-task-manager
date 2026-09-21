// Drizzle ORM schema (SQLite dialect — works for a local file and for Turso/libSQL).
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
});

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    doneAt: integer('done_at'),
    createdAt: integer('created_at').notNull(),
    dueDate: text('due_date'), // YYYY-MM-DD, wall-clock date of the user
    dueTime: text('due_time'), // HH:mm
    priority: text('priority').notNull().default('normal'), // low | normal | high
    tags: text('tags', { mode: 'json' }).notNull(), // string[]
  },
  (t) => [index('tasks_user_idx').on(t.userId)],
);

/** Every phrase the user says, with the engine that understood it. Handy for debugging and analytics. */
export const commands = sqliteTable(
  'commands',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    source: text('source').notNull(), // voice | text | realtime
    engine: text('engine').notNull(), // anthropic | openai | local | realtime
    model: text('model'),
    ms: integer('ms'),
    actions: integer('actions').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('commands_user_idx').on(t.userId, t.createdAt)],
);
