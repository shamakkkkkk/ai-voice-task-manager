// Business logic of the app. Depends only on a repo (db/repo.js or memoryRepo.js) and an NLU function,
// so every path — typed command, voice command, Realtime tool call, undo — is unit-tested without a database.
import { applyActions } from '../commands.js';
import { normalizeActions } from '../nlu/schema.js';
import { parseCommand } from '../nlu/llm.js';
import { TaskSchema } from '../nlu/schema.js';

const FIELDS = ['title', 'done', 'doneAt', 'createdAt', 'dueDate', 'dueTime', 'priority'];
const sameTask = (a, b) => FIELDS.every((k) => a[k] === b[k]) && JSON.stringify(a.tags) === JSON.stringify(b.tags);

/** What has to change in the database to go from `before` to `after`. */
export function diffTasks(before, after) {
  const prev = new Map(before.map((t) => [t.id, t]));
  const nextIds = new Set(after.map((t) => t.id));
  const inserts = [];
  const updates = [];
  for (const t of after) {
    const old = prev.get(t.id);
    if (!old) inserts.push(t);
    else if (!sameTask(old, t)) updates.push(t);
  }
  const deleteIds = before.filter((t) => !nextIds.has(t.id)).map((t) => t.id);
  return { inserts, updates, deleteIds };
}

const dueString = (t) => (t.dueDate ? `${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''}` : null);
const brief = (t) => ({ id: t.id, title: t.title, due: dueString(t), priority: t.priority });

/** Maps a Realtime function call to the same action format every other engine produces. */
export function toolToActions(name, args = {}) {
  const blank = { title: null, dueDate: null, dueTime: null, priority: null, tags: [], taskId: null, query: null };
  switch (name) {
    case 'add_task':
      return [{ ...blank, type: 'add', title: args.title, dueDate: args.due_date ?? null, dueTime: args.due_time ?? null, priority: args.priority ?? 'normal', tags: args.tags ?? [] }];
    case 'complete_task':
      return [{ ...blank, type: 'complete', taskId: args.task_id ?? null, query: args.query ?? null }];
    case 'delete_task':
      return [{ ...blank, type: 'delete', taskId: args.task_id ?? null, query: args.query ?? null }];
    default:
      return null;
  }
}

export function createTaskService({ repo, parse = (input) => parseCommand(input) }) {
  const persist = (userId, before, after) => repo.saveChanges(userId, diffTasks(before, after));
  const load = async (userId) => {
    await repo.ensureUser(userId);
    return repo.listTasks(userId);
  };

  return {
    list: load,

    /** Typed or spoken phrase → NLU → tasks changed in the database. */
    async command(userId, { text, today, now, timezone, locale, source = 'text' }) {
      const before = await load(userId);
      const open = before.filter((t) => !t.done).slice(-60);
      const nlu = await parse({ text, today, now, timezone, locale, tasks: open.map(({ id, title }) => ({ id, title })) });
      const { tasks, summary } = applyActions(before, nlu.actions);
      await persist(userId, before, tasks);
      await repo
        .logCommand(userId, { text, source, engine: nlu.engine, model: nlu.model, ms: nlu.ms, actions: nlu.actions.length })
        .catch(() => {}); // analytics must never break the request
      return { tasks, summary, engine: nlu.engine, model: nlu.model, ms: nlu.ms, fallbackReason: nlu.fallbackReason };
    },

    async setDone(userId, id, done) {
      const before = await load(userId);
      const hit = before.find((t) => t.id === id);
      if (!hit) return null;
      const tasks = before.map((t) => (t.id === id ? { ...t, done, doneAt: done ? Date.now() : null } : t));
      await persist(userId, before, tasks);
      return tasks;
    },

    async remove(userId, id) {
      const before = await load(userId);
      if (!before.some((t) => t.id === id)) return null;
      const tasks = before.filter((t) => t.id !== id);
      await persist(userId, before, tasks);
      return tasks;
    },

    async clearDone(userId) {
      const before = await load(userId);
      const tasks = before.filter((t) => !t.done);
      await persist(userId, before, tasks);
      return tasks;
    },

    /** Undo: make the user's task list equal to a snapshot the client kept. */
    async restore(userId, snapshot) {
      const list = snapshot.map((t) => TaskSchema.parse(t));
      const before = await load(userId);
      await persist(userId, before, list);
      return list;
    },

    /** A function call coming from the OpenAI Realtime model. Always returns something the model can read out. */
    async tool(userId, { name, args, today, now }) {
      const before = await load(userId);

      if (name === 'list_tasks') {
        const scope = args?.scope === 'today' || args?.scope === 'done' ? args.scope : 'open';
        let rows = before;
        if (scope === 'done') rows = before.filter((t) => t.done);
        else rows = before.filter((t) => !t.done && (scope === 'open' || (t.dueDate && t.dueDate <= today)));
        const shown = rows.slice(0, 25).map(brief);
        return { tasks: before, summary: null, output: { ok: true, scope, count: rows.length, tasks: shown } };
      }

      const raw = toolToActions(name, args);
      if (!raw) return { tasks: before, summary: null, output: { ok: false, error: `unknown_tool:${name}` } };

      let actions;
      try {
        actions = normalizeActions({ actions: raw }, { today, now });
      } catch {
        return { tasks: before, summary: null, output: { ok: false, error: 'invalid_arguments' } };
      }
      if (!actions.length) return { tasks: before, summary: null, output: { ok: false, error: 'invalid_arguments' } };

      const { tasks, summary } = applyActions(before, actions);
      await persist(userId, before, tasks);
      await repo
        .logCommand(userId, { text: `${name} ${JSON.stringify(args ?? {})}`.slice(0, 400), source: 'realtime', engine: 'realtime', model: null, ms: null, actions: actions.length })
        .catch(() => {});
      const output = {
        ok: true,
        added: summary.added.map(brief),
        completed: summary.completed.map(brief),
        deleted: summary.deleted.map(brief),
        not_found: summary.missed,
        open_tasks: tasks.filter((t) => !t.done).length,
      };
      return { tasks, summary, output };
    },
  };
}
