import { z } from 'zod';
import { addDays, isValidDate, isValidTime } from '../dates.js';

/**
 * One flat action shape shared by every engine (Claude tool-use, OpenAI structured outputs, local parser).
 * Every property is required and nullable so the same schema satisfies OpenAI's strict mode.
 */
export const ACTIONS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actions'],
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'dueDate', 'dueTime', 'priority', 'tags', 'taskId', 'query'],
        properties: {
          type: { type: 'string', enum: ['add', 'complete', 'delete'] },
          title: { type: ['string', 'null'], description: 'add: short task title without date/time words' },
          dueDate: { type: ['string', 'null'], description: 'add: YYYY-MM-DD or null' },
          dueTime: { type: ['string', 'null'], description: 'add: HH:mm (24h) or null' },
          priority: { type: ['string', 'null'], enum: ['low', 'normal', 'high', null] },
          tags: { type: 'array', items: { type: 'string' } },
          taskId: { type: ['string', 'null'], description: 'complete/delete: id of the matching existing task' },
          query: { type: ['string', 'null'], description: 'complete/delete: the words the user used for the task' },
        },
      },
    },
  },
};

const ActionSchema = z.object({
  type: z.enum(['add', 'complete', 'delete']),
  title: z.string().nullish(),
  dueDate: z.string().nullish(),
  dueTime: z.string().nullish(),
  priority: z.enum(['low', 'normal', 'high']).nullish(),
  tags: z.array(z.string()).nullish(),
  taskId: z.string().nullish(),
  query: z.string().nullish(),
});

const ActionsSchema = z.object({ actions: z.array(ActionSchema).max(12) });

const dateField = z.string().refine(isValidDate, 'date must be YYYY-MM-DD');
const timeField = z.string().refine(isValidTime, 'time must be HH:mm');

/** Wall-clock context the browser sends with every request that needs "today". */
const contextShape = {
  today: dateField,
  now: timeField,
  timezone: z.string().max(64).optional(),
  locale: z.enum(['ru', 'en']).default('en'),
};

/** Body accepted by POST /api/command. */
export const CommandRequestSchema = z.object({
  text: z.string().trim().min(1).max(400),
  source: z.enum(['voice', 'text']).default('text'),
  ...contextShape,
});

/** Body accepted by POST /api/realtime/session and /api/realtime/tool (plus their own fields). */
export const ClientContextSchema = z.object(contextShape);

export const TaskSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(120),
  done: z.boolean(),
  doneAt: z.number().nullable(),
  createdAt: z.number(),
  dueDate: dateField.nullable(),
  dueTime: timeField.nullable(),
  priority: z.enum(['low', 'normal', 'high']),
  tags: z.array(z.string().max(24)).max(3),
});

/** Body accepted by POST /api/tasks/restore (undo). */
export const RestoreSchema = z.object({ tasks: z.array(TaskSchema).max(500) });

const clean = (s, max) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Validates whatever an engine returned and turns it into safe, canonical actions.
 * Throws when the payload has the wrong shape so the caller can fall back to another engine.
 */
export function normalizeActions(raw, { today, now = '09:00' } = {}) {
  const parsed = ActionsSchema.parse(raw);
  const out = [];

  for (const a of parsed.actions) {
    if (a.type === 'add') {
      const title = clean(a.title, 120);
      if (!title) continue;
      let dueDate = isValidDate(a.dueDate) ? a.dueDate : null;
      const dueTime = isValidTime(a.dueTime) ? a.dueTime : null;
      if (!dueDate && dueTime && today) dueDate = dueTime > now ? today : addDays(today, 1);
      const tags = [...new Set((a.tags ?? []).map((t) => clean(t, 24).toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 3);
      out.push({
        type: 'add',
        title: title.charAt(0).toUpperCase() + title.slice(1),
        dueDate,
        dueTime: dueDate ? dueTime : null,
        priority: a.priority ?? 'normal',
        tags,
        taskId: null,
        query: null,
      });
    } else {
      const taskId = clean(a.taskId, 64) || null;
      const query = clean(a.query, 120) || null;
      if (!taskId && !query) continue;
      out.push({ type: a.type, title: null, dueDate: null, dueTime: null, priority: null, tags: [], taskId, query });
    }
  }
  return out;
}
