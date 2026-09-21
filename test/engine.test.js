import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActions, CommandRequestSchema } from '../lib/nlu/schema.js';
import { buildSystemPrompt, parseCommand, pickProvider } from '../lib/nlu/llm.js';
import { rateLimit, resetRateLimit } from '../lib/rateLimit.js';

const input = { text: 'buy milk tomorrow', today: '2026-09-18', now: '14:20', timezone: 'UTC', locale: 'en', tasks: [] };
const llmAction = { type: 'add', title: 'buy milk', dueDate: '2026-09-19', dueTime: null, priority: 'normal', tags: [], taskId: null, query: null };

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('normalizeActions cleans and validates', () => {
  const out = normalizeActions(
    { actions: [
      { type: 'add', title: '  buy   milk ', dueDate: '2026-02-31', dueTime: '25:00', priority: null, tags: ['#Home', 'home', ''] },
      { type: 'add', title: '   ' },
      { type: 'complete', taskId: null, query: null },
      { type: 'delete', taskId: 'x' },
    ] },
    { today: '2026-09-18' },
  );
  assert.equal(out.length, 2);
  assert.deepEqual(
    { title: out[0].title, dueDate: out[0].dueDate, dueTime: out[0].dueTime, tags: out[0].tags },
    { title: 'Buy milk', dueDate: null, dueTime: null, tags: ['home'] },
  );
  assert.equal(out[1].type, 'delete');
});

test('normalizeActions: time-only becomes today or tomorrow', () => {
  const later = normalizeActions({ actions: [{ type: 'add', title: 'x', dueTime: '18:00' }] }, { today: '2026-09-18', now: '14:00' });
  assert.equal(later[0].dueDate, '2026-09-18');
  const passed = normalizeActions({ actions: [{ type: 'add', title: 'x', dueTime: '09:00' }] }, { today: '2026-09-18', now: '14:00' });
  assert.equal(passed[0].dueDate, '2026-09-19');
});

test('normalizeActions rejects a wrong shape', () => {
  assert.throws(() => normalizeActions({ nope: true }, { today: '2026-09-18' }));
  assert.throws(() => normalizeActions({ actions: [{ type: 'explode' }] }, { today: '2026-09-18' }));
});

test('request schema', () => {
  const body = { text: input.text, today: input.today, now: input.now, locale: 'en' };
  assert.ok(CommandRequestSchema.safeParse(body).success);
  assert.ok(!CommandRequestSchema.safeParse({ ...body, today: '18.09.2026' }).success);
  assert.ok(!CommandRequestSchema.safeParse({ ...body, text: 'x'.repeat(401) }).success);
  assert.equal(CommandRequestSchema.parse(body).source, 'text');
});

test('pickProvider', () => {
  assert.equal(pickProvider({}), null);
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: 'k' }), 'anthropic');
  assert.equal(pickProvider({ OPENAI_API_KEY: 'k' }), 'openai');
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', AI_PROVIDER: 'openai' }), 'openai');
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: 'k', AI_PROVIDER: 'local' }), null);
});

test('system prompt carries the date and existing tasks', () => {
  const p = buildSystemPrompt({ ...input, tasks: [{ id: 'a1', title: 'Milk' }] });
  assert.match(p, /2026-09-18 \(Friday\)/);
  assert.match(p, /"id":"a1"/);
});

test('no key: local engine answers', async () => {
  const r = await parseCommand(input, { env: {} });
  assert.equal(r.engine, 'local');
  assert.equal(r.actions[0].title, 'Buy milk');
  assert.equal(r.actions[0].dueDate, '2026-09-19');
});

test('anthropic: forced tool call is read and validated', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, body: JSON.parse(init.body), headers: init.headers };
    return jsonResponse({ content: [{ type: 'tool_use', name: 'submit_actions', input: { actions: [llmAction] } }] });
  };
  const r = await parseCommand(input, { env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl });
  assert.equal(r.engine, 'anthropic');
  assert.equal(r.actions[0].title, 'Buy milk');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.headers['x-api-key'], 'sk-test');
  assert.deepEqual(seen.body.tool_choice, { type: 'tool', name: 'submit_actions' });
});

test('openai: structured output is parsed', async () => {
  const fetchImpl = async () => jsonResponse({ choices: [{ message: { content: JSON.stringify({ actions: [llmAction] }) } }] });
  const r = await parseCommand(input, { env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl });
  assert.equal(r.engine, 'openai');
  assert.equal(r.actions[0].dueDate, '2026-09-19');
});

test('LLM failures never surface: HTTP error, bad JSON, wrong shape, network', async () => {
  const cases = [
    async () => jsonResponse({}, 500),
    async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'hi' }] }) }),
    async () => jsonResponse({ content: [{ type: 'tool_use', input: { actions: 'nope' } }] }),
    async () => { throw new TypeError('fetch failed'); },
  ];
  for (const fetchImpl of cases) {
    const r = await parseCommand(input, { env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl });
    assert.equal(r.engine, 'local');
    assert.equal(r.fallbackReason, 'llm_error');
    assert.equal(r.actions[0].title, 'Buy milk');
  }
});

test('rate limiter blocks after the limit and recovers after the window', () => {
  resetRateLimit();
  for (let i = 0; i < 3; i++) assert.ok(rateLimit('ip', { limit: 3, windowMs: 1000 }, 0).ok);
  assert.ok(!rateLimit('ip', { limit: 3, windowMs: 1000 }, 10).ok);
  assert.ok(rateLimit('ip', { limit: 3, windowMs: 1000 }, 1500).ok);
  assert.ok(rateLimit('other', { limit: 3, windowMs: 1000 }, 10).ok);
});
