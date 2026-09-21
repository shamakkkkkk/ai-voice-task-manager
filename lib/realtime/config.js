// Everything the server tells the OpenAI Realtime API about this app: instructions and callable tools.
import { dayOfWeek } from '../dates.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const REALTIME_DEFAULTS = {
  model: 'gpt-realtime',
  voice: 'marin',
  transcriptionModel: 'gpt-4o-mini-transcribe',
};

/** Tried in order until OpenAI accepts one: the configured model, the stable alias, then the previous snapshot. */
export function modelCandidates(env = {}) {
  return [...new Set([env.OPENAI_REALTIME_MODEL, REALTIME_DEFAULTS.model, 'gpt-realtime-2'].filter(Boolean))];
}

export const REALTIME_TOOLS = [
  {
    type: 'function',
    name: 'add_task',
    description: 'Create one task. Call once per task when the user mentions several.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short imperative title in the user\'s language, without date, time or priority words.' },
        due_date: { type: 'string', description: 'YYYY-MM-DD resolved from the current date. Omit if the user gave no date.' },
        due_time: { type: 'string', description: '24-hour HH:mm, only if the user said a time.' },
        priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'high only when the user stresses urgency.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'At most 3 short lowercase tags, only if the user named a project or category.' },
      },
      required: ['title'],
    },
  },
  {
    type: 'function',
    name: 'complete_task',
    description: 'Mark an existing task as done.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'id from list_tasks if known.' },
        query: { type: 'string', description: 'The words the user used to refer to the task.' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'delete_task',
    description: 'Delete an existing task.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'id from list_tasks if known.' },
        query: { type: 'string', description: 'The words the user used to refer to the task.' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'list_tasks',
    description: 'Read the user\'s tasks. Use it before answering any question about what is on the list.',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['open', 'today', 'done'], description: 'today = open tasks due today or overdue.' },
      },
    },
  },
];

export const TOOL_NAMES = REALTIME_TOOLS.map((t) => t.name);

export function buildInstructions({ today, now, timezone, locale }) {
  const weekday = WEEKDAYS[dayOfWeek(today)];
  const lang = locale === 'ru' ? 'Russian' : 'English';
  return `You are the voice of a task manager. The user talks to you to add, complete, delete and read tasks.

Language: reply in the language the user speaks (default ${lang}). Sound natural and calm.
Style: extremely brief. After an action, confirm in one short sentence ("Done: call mom, tomorrow at 5 PM"). No greetings, no follow-up offers.
Truthfulness: change tasks only by calling a tool, and only say a task was added, completed or deleted if the tool result says so. If a tool result lists not_found, say you could not find it.
Questions about the list ("what do I have today?") must call list_tasks first, then read out at most five items.
If a request is unclear, ask one short question instead of guessing.

Current date: ${today} (${weekday}). Current local time: ${now}. Time zone: ${timezone || 'unknown'}.
Resolve relative dates yourself: a weekday name means the next such day after today, "next week" means next Monday. Pass due_date as YYYY-MM-DD and due_time as HH:mm (24-hour) only when the user said a time.`;
}

/**
 * Body for POST /v1/realtime/client_secrets.
 * `minimal` drops the optional knobs (transcription language) in case the API rejects them.
 */
export function buildClientSecretBody(ctx, { model, voice, ttlSeconds = 120, minimal = false } = {}) {
  const session = {
    type: 'realtime',
    model: model || REALTIME_DEFAULTS.model,
    instructions: buildInstructions(ctx),
    tools: REALTIME_TOOLS,
    tool_choice: 'auto',
    audio: {
      output: { voice: voice || REALTIME_DEFAULTS.voice },
    },
  };
  if (!minimal) {
    session.audio.input = {
      transcription: { model: REALTIME_DEFAULTS.transcriptionModel, language: ctx.locale === 'ru' ? 'ru' : 'en' },
    };
  }
  return { expires_after: { anchor: 'created_at', seconds: ttlSeconds }, session };
}
