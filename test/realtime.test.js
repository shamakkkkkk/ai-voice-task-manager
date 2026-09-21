import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientSecretBody, buildInstructions, REALTIME_TOOLS } from '../lib/realtime/config.js';
import { createEventHandler, toolOutputEvents } from '../lib/realtime/events.js';

const ctx = { today: '2026-09-18', now: '14:20', timezone: 'Europe/Moscow', locale: 'ru' };

test('client secret body follows the GA shape', () => {
  const body = buildClientSecretBody(ctx, { model: 'gpt-realtime-2' });
  assert.deepEqual(body.expires_after, { anchor: 'created_at', seconds: 120 });
  assert.equal(body.session.type, 'realtime');
  assert.equal(body.session.model, 'gpt-realtime-2');
  assert.equal(body.session.audio.output.voice, 'marin');
  assert.equal(body.session.audio.input.transcription.language, 'ru');
  assert.deepEqual(body.session.tools.map((t) => t.name), ['add_task', 'complete_task', 'delete_task', 'list_tasks']);
  assert.ok(body.session.tools.every((t) => t.type === 'function' && t.parameters.type === 'object'));
  const minimal = buildClientSecretBody(ctx, { minimal: true });
  assert.equal(minimal.session.audio.input, undefined);
});

test('instructions carry date, weekday and time zone', () => {
  const p = buildInstructions(ctx);
  assert.match(p, /2026-09-18 \(Friday\)/);
  assert.match(p, /Europe\/Moscow/);
  assert.match(p, /Russian/);
  assert.equal(REALTIME_TOOLS.length, 4);
});

test('event handler: a full voice turn with a tool call', () => {
  const log = [];
  const handle = createEventHandler({
    onPhase: (p) => log.push(['phase', p]),
    onUserInterim: (t) => log.push(['userInterim', t]),
    onUserText: (t) => log.push(['user', t]),
    onAssistantText: (t) => log.push(['bot', t]),
    onToolCalls: (c) => log.push(['tools', c]),
    onIdle: () => log.push(['idle']),
    onError: (m) => log.push(['error', m]),
  });

  handle({ type: 'input_audio_buffer.speech_started' });
  handle({ type: 'input_audio_buffer.speech_stopped' });
  handle({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'Напомни ' });
  handle({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'позвонить маме' });
  handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'Напомни позвонить маме завтра' });
  const done = {
    type: 'response.done',
    response: { status: 'completed', output: [{ type: 'function_call', name: 'add_task', call_id: 'call_1', arguments: '{"title":"Позвонить маме","due_date":"2026-09-19"}' }] },
  };
  handle(done);
  handle(done); // duplicate delivery must not execute the tool twice
  handle({ type: 'output_audio_buffer.started' });
  handle({ type: 'response.output_audio_transcript.done', item_id: 'i2', transcript: 'Готово.' });
  handle({ type: 'output_audio_buffer.stopped' });
  handle({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message' }] } });
  handle({ type: 'error', error: { message: 'boom' } });

  assert.deepEqual(log.filter(([k]) => k === 'userInterim').map(([, t]) => t), ['Напомни', 'Напомни позвонить маме']);
  assert.deepEqual(log.find(([k]) => k === 'user'), ['user', 'Напомни позвонить маме завтра']);
  const tools = log.filter(([k]) => k === 'tools');
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0][1], [{ callId: 'call_1', name: 'add_task', args: { title: 'Позвонить маме', due_date: '2026-09-19' } }]);
  assert.ok(log.some(([k, v]) => k === 'phase' && v === 'speaking'));
  assert.deepEqual(log.find(([k]) => k === 'bot'), ['bot', 'Готово.']);
  assert.deepEqual(log.at(-1), ['error', 'boom']);
});

test('event handler survives broken arguments and unknown events', () => {
  const calls = [];
  const handle = createEventHandler({ onToolCalls: (c) => calls.push(c) });
  handle({ type: 'session.created' });
  handle(undefined);
  handle({ type: 'response.done', response: { output: [{ type: 'function_call', name: 'list_tasks', call_id: 'c', arguments: '{oops' }] } });
  assert.deepEqual(calls[0][0].args, {});
});

test('tool outputs are sent back followed by exactly one response.create', () => {
  const events = toolOutputEvents([
    { callId: 'a', output: { ok: true } },
    { callId: 'b', output: { ok: false } },
  ]);
  assert.equal(events.length, 3);
  assert.equal(events[0].item.type, 'function_call_output');
  assert.equal(events[0].item.output, '{"ok":true}');
  assert.deepEqual(events[2], { type: 'response.create' });
});

import { createClientSecret } from '../lib/realtime/session.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

test('createClientSecret: no key → unavailable', async () => {
  const r = await createClientSecret(ctx, { env: {} });
  assert.deepEqual([r.ok, r.status, r.error], [false, 503, 'realtime_unavailable']);
});

test('createClientSecret: sends key server-side and returns only the ephemeral value', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return ok({ value: 'ek_123', expires_at: 1770000000 });
  };
  const r = await createClientSecret(ctx, { userId: 'u-1', env: { OPENAI_API_KEY: 'sk-secret', OPENAI_REALTIME_MODEL: 'gpt-realtime-2.1' }, fetchImpl });
  assert.deepEqual(r, { ok: true, clientSecret: 'ek_123', expiresAt: 1770000000, model: 'gpt-realtime-2.1' });
  assert.equal(seen.url, 'https://api.openai.com/v1/realtime/client_secrets');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-secret');
  assert.match(seen.init.headers['OpenAI-Safety-Identifier'], /^[0-9a-f]{32}$/);
  assert.equal(seen.body.session.model, 'gpt-realtime-2.1');
  assert.ok(!JSON.stringify(r).includes('sk-secret'));
});

test('createClientSecret: retries with a minimal config on HTTP 400, maps other failures to 502', async () => {
  const bodies = [];
  const retry = async (_u, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1 ? fail(400) : ok({ value: 'ek_ok' });
  };
  const r = await createClientSecret(ctx, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: retry });
  assert.equal(r.ok, true);
  assert.ok(bodies[0].session.audio.input);
  assert.equal(bodies[1].session.audio.input, undefined);

  const down = await createClientSecret(ctx, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: async () => fail(500) });
  assert.deepEqual([down.ok, down.status], [false, 502]);
  const boom = await createClientSecret(ctx, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: async () => { throw new Error('net'); } });
  assert.deepEqual([boom.ok, boom.status], [false, 502]);
});

test('createClientSecret: classifies failures and never burns through models on a bad key', async () => {
  const calls = [];
  const status = (code, message = '') => async (url, init) => {
    calls.push(JSON.parse(init.body).session.model);
    return { ok: false, status: code, json: async () => ({ error: { message } }) };
  };
  let r = await createClientSecret(ctx, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: status(401, 'Incorrect API key provided: sk-abc123def456') });
  assert.deepEqual([r.ok, r.error], [false, 'realtime_invalid_key']);
  assert.ok(!r.detail.includes('abc123'), 'secrets in upstream messages are masked');
  assert.equal(calls.length, 1);

  calls.length = 0;
  r = await createClientSecret(ctx, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: status(429, 'You exceeded your current quota') });
  assert.equal(r.error, 'realtime_quota');
  assert.match(r.detail, /quota/);
});

test('createClientSecret: falls back to the next model when one is not available', async () => {
  const tried = [];
  const fetchImpl = async (_u, init) => {
    const model = JSON.parse(init.body).session.model;
    tried.push(model);
    return model === 'gpt-realtime-2.1' ? { ok: false, status: 404, json: async () => ({ error: { message: 'model not found' } }) } : ok({ value: 'ek_fallback' });
  };
  const r = await createClientSecret(ctx, { env: { OPENAI_API_KEY: 'k', OPENAI_REALTIME_MODEL: 'gpt-realtime-2.1' }, fetchImpl });
  assert.deepEqual(tried, ['gpt-realtime-2.1', 'gpt-realtime']);
  assert.deepEqual([r.ok, r.model, r.clientSecret], [true, 'gpt-realtime', 'ek_fallback']);

  const none = await createClientSecret(ctx, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'no access' } }) }) });
  assert.deepEqual([none.error, none.detail], ['realtime_model', 'no access']);
});

test('createClientSecret: a visitor-supplied key wins over the server key and is only sent as Authorization', async () => {
  let seen;
  const fetchImpl = async (_u, init) => {
    seen = init;
    return ok({ value: 'ek_byok' });
  };
  const r = await createClientSecret(ctx, { apiKey: 'sk-visitor-key-0123456789', env: { OPENAI_API_KEY: 'sk-server' }, fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(seen.headers.Authorization, 'Bearer sk-visitor-key-0123456789');
  assert.ok(!seen.body.includes('sk-visitor'));
});

test('event handler: first words of an answer mean "speaking"; a finished answer signals the watchdog', () => {
  const log = [];
  const handle = createEventHandler({ onPhase: (p) => log.push(p), onResponseEnd: () => log.push('end') });
  handle({ type: 'response.output_audio_transcript.delta', item_id: 'a', delta: 'Готово' });
  handle({ type: 'response.output_audio_transcript.delta', item_id: 'a', delta: '.' });
  handle({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message' }] } });
  assert.deepEqual(log, ['speaking', 'end']);
});
