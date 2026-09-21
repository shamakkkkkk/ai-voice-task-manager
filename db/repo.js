import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from './client.js';
import { commands, tasks, users } from './schema.js';

export const rowToTask = (r) => ({
  id: r.id,
  title: r.title,
  done: Boolean(r.done),
  doneAt: r.doneAt ?? null,
  createdAt: r.createdAt,
  dueDate: r.dueDate ?? null,
  dueTime: r.dueTime ?? null,
  priority: r.priority,
  tags: Array.isArray(r.tags) ? r.tags : [],
});

export const taskToRow = (userId, t) => ({
  id: t.id,
  userId,
  title: t.title,
  done: Boolean(t.done),
  doneAt: t.doneAt ?? null,
  createdAt: t.createdAt,
  dueDate: t.dueDate ?? null,
  dueTime: t.dueTime ?? null,
  priority: t.priority ?? 'normal',
  tags: t.tags ?? [],
});

/**
 * The only place that talks SQL. Everything above it (services, routes) depends on this small interface,
 * so tests can swap in lib/server/memoryRepo.js.
 */
export function createDrizzleRepo(db) {
  return {
    async ensureUser(userId) {
      await db.insert(users).values({ id: userId, createdAt: Date.now() }).onConflictDoNothing();
    },

    async listTasks(userId) {
      const rows = await db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.createdAt));
      return rows.map(rowToTask);
    },

    /** Applies a diff atomically: all of it or none of it. Rows are always scoped to `userId`. */
    async saveChanges(userId, { inserts = [], updates = [], deleteIds = [] }) {
      if (!inserts.length && !updates.length && !deleteIds.length) return;
      await db.transaction(async (tx) => {
        if (inserts.length) await tx.insert(tasks).values(inserts.map((t) => taskToRow(userId, t)));
        for (const t of updates) {
          const { id, userId: _owner, ...fields } = taskToRow(userId, t);
          await tx.update(tasks).set(fields).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
        }
        if (deleteIds.length) await tx.delete(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.id, deleteIds)));
      });
    },

    async logCommand(userId, entry) {
      await db.insert(commands).values({
        userId,
        text: entry.text.slice(0, 400),
        source: entry.source,
        engine: entry.engine,
        model: entry.model ?? null,
        ms: entry.ms ?? null,
        actions: entry.actions ?? 0,
        createdAt: Date.now(),
      });
    },
  };
}

export async function getRepo() {
  return createDrizzleRepo(await getDb());
}
