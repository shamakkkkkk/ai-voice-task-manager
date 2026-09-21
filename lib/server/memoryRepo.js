// In-memory implementation of the repo interface (see db/repo.js). Used by the unit tests so the
// business logic can be verified without a database.
export function createMemoryRepo() {
  const users = new Set();
  const byUser = new Map();
  const log = [];
  const clone = (t) => ({ ...t, tags: [...t.tags] });
  return {
    log,
    async ensureUser(userId) {
      users.add(userId);
      if (!byUser.has(userId)) byUser.set(userId, new Map());
    },
    async listTasks(userId) {
      return [...(byUser.get(userId)?.values() ?? [])].sort((a, b) => a.createdAt - b.createdAt).map(clone);
    },
    async saveChanges(userId, { inserts = [], updates = [], deleteIds = [] }) {
      const all = new Map();
      for (const m of byUser.values()) for (const t of m.values()) all.set(t.id, true);
      const mine = byUser.get(userId);
      for (const t of inserts) {
        if (all.has(t.id)) throw new Error('UNIQUE constraint failed: tasks.id'); // like a real primary key
        mine.set(t.id, clone(t));
      }
      for (const t of updates) if (mine.has(t.id)) mine.set(t.id, clone(t));
      for (const id of deleteIds) mine.delete(id);
    },
    async logCommand(userId, entry) {
      log.push({ userId, ...entry });
    },
  };
}
