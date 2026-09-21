// End-to-end tests of the real route handlers (cookie identity, validation, rate limits, undo)
// against an in-memory repo — the SQL layer is covered separately in db.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.AI_PROVIDER;

const { setRepoFactory } = await import('../lib/server/container.js');
const { createMemoryRepo } = await import('../lib/server/memoryRepo.js');
const { resetRateLimit } = await import('../lib/rateLimit.js');
const tasksRoute = await import('../app/api/tasks/route.js');
const taskRoute = await import('../app/api/tasks/[id]/route.js');
const restoreRoute = await import('../app/api/tasks/restore/route.js');
const clearRoute = await import('../app/api/tasks/clear-done/route.js');
const commandRoute = await import('../app/api/command/route.js');
const toolRoute = await import('../app/api/realtime/tool/route.js');
const sessionRoute = await import('../app/api/realtime/session/route.js');

const repo = createMemoryRepo();
setRepoFactory(async () => repo);

const ctx = { today: '2026-09-18', now: '14:20', timezone: 'UTC', locale: 'en' };
const req = (method, url, { body, cookie, ip = '10.0.0.1' } = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0];

test('first visit gets an identity cookie, the next request reuses it', async () => {
  resetRateLimit();
  const r1 = await tasksRoute.GET(req('GET', '/api/tasks'));
  const cookie = cookieOf(r1);
  assert.match(cookie, /^tm_uid=[0-9a-f-]{36}$/);
  assert.match(r1.headers.get('set-cookie'), /HttpOnly/);
  const r2 = await tasksRoute.GET(req('GET', '/api/tasks', { cookie }));
  assert.equal(r2.headers.get('set-cookie'), null);
  assert.deepEqual(await r2.json(), { tasks: [] });
});

test('command → list → toggle → delete → undo, all through the routes', async () => {
  resetRateLimit();
  const cookie = cookieOf(await tasksRoute.GET(req('GET', '/api/tasks')));

  const cmd = await commandRoute.POST(req('POST', '/api/command', { cookie, body: { ...ctx, text: 'remind me to call mom tomorrow at 5pm urgent', source: 'voice' } }));
  assert.equal(cmd.status, 200);
  const created = await cmd.json();
  assert.equal(created.engine, 'local');
  assert.equal(created.tasks.length, 1);
  assert.deepEqual([created.tasks[0].title, created.tasks[0].dueDate, created.tasks[0].dueTime, created.tasks[0].priority], ['Call mom', '2026-09-19', '17:00', 'high']);
  const id = created.tasks[0].id;

  let res = await taskRoute.PATCH(req('PATCH', `/api/tasks/${id}`, { cookie, body: { done: true } }), { params: Promise.resolve({ id }) });
  assert.equal((await res.json()).tasks[0].done, true);
  res = await taskRoute.PATCH(req('PATCH', `/api/tasks/${id}`, { cookie, body: { done: 'yes' } }), { params: Promise.resolve({ id }) });
  assert.equal(res.status, 400);

  const before = (await (await tasksRoute.GET(req('GET', '/api/tasks', { cookie }))).json()).tasks;
  res = await taskRoute.DELETE(req('DELETE', `/api/tasks/${id}`, { cookie }), { params: Promise.resolve({ id }) });
  assert.deepEqual((await res.json()).tasks, []);
  res = await taskRoute.DELETE(req('DELETE', `/api/tasks/${id}`, { cookie }), { params: Promise.resolve({ id }) });
  assert.equal(res.status, 404);

  res = await restoreRoute.POST(req('POST', '/api/tasks/restore', { cookie, body: { tasks: before } }));
  assert.equal((await res.json()).tasks.length, 1);

  res = await clearRoute.POST(req('POST', '/api/tasks/clear-done', { cookie }));
  assert.equal((await res.json()).tasks.length, 0); // the restored task was done
});

test('users cannot see or touch each other\'s tasks', async () => {
  resetRateLimit();
  const alice = cookieOf(await tasksRoute.GET(req('GET', '/api/tasks')));
  const bob = cookieOf(await tasksRoute.GET(req('GET', '/api/tasks')));
  assert.notEqual(alice, bob);
  const made = await (await commandRoute.POST(req('POST', '/api/command', { cookie: alice, body: { ...ctx, text: 'private thing' } }))).json();
  const id = made.tasks[0].id;
  assert.deepEqual(await (await tasksRoute.GET(req('GET', '/api/tasks', { cookie: bob }))).json(), { tasks: [] });
  const res = await taskRoute.DELETE(req('DELETE', `/api/tasks/${id}`, { cookie: bob }), { params: Promise.resolve({ id }) });
  assert.equal(res.status, 404);
  const steal = await restoreRoute.POST(req('POST', '/api/tasks/restore', { cookie: bob, body: { tasks: made.tasks } }));
  assert.equal(steal.status, 409);
});

test('validation and forged cookies', async () => {
  resetRateLimit();
  let res = await commandRoute.POST(req('POST', '/api/command', { body: { text: 'hi', today: '18.09.2026', now: '14:20' } }));
  assert.equal(res.status, 400);
  res = await commandRoute.POST(new Request('http://localhost/api/command', { method: 'POST', body: 'not json' }));
  assert.equal(res.status, 400);
  res = await tasksRoute.GET(req('GET', '/api/tasks', { cookie: 'tm_uid=../../etc/passwd' }));
  assert.match(cookieOf(res), /^tm_uid=[0-9a-f-]{36}$/); // garbage is ignored, a fresh identity is issued
});

test('command endpoint is rate limited', async () => {
  resetRateLimit();
  process.env.RATE_LIMIT_PER_MIN = '2';
  const codes = [];
  for (let i = 0; i < 4; i++) {
    const r = await commandRoute.POST(req('POST', '/api/command', { ip: '7.7.7.7', body: { ...ctx, text: `task ${i}` } }));
    codes.push(r.status);
  }
  delete process.env.RATE_LIMIT_PER_MIN;
  assert.deepEqual(codes, [200, 200, 429, 429]);
});

test('realtime tool endpoint executes tools and rejects unknown ones', async () => {
  resetRateLimit();
  const cookie = cookieOf(await tasksRoute.GET(req('GET', '/api/tasks')));
  let res = await toolRoute.POST(req('POST', '/api/realtime/tool', { cookie, body: { ...ctx, name: 'add_task', args: { title: 'water plants', due_date: '2026-09-19' } } }));
  const body = await res.json();
  assert.equal(body.output.ok, true);
  assert.equal(body.tasks[0].title, 'Water plants');
  res = await toolRoute.POST(req('POST', '/api/realtime/tool', { cookie, body: { ...ctx, name: 'rm_rf', args: {} } }));
  assert.equal(res.status, 400);
  res = await toolRoute.POST(req('POST', '/api/realtime/tool', { cookie, body: { ...ctx, name: 'list_tasks', args: [] } }));
  assert.equal(res.status, 400);
});

test('realtime session endpoint says "unavailable" without a key', async () => {
  resetRateLimit();
  const res = await sessionRoute.POST(req('POST', '/api/realtime/session', { body: ctx }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'realtime_unavailable');
});

const capabilitiesRoute = await import('../app/api/capabilities/route.js');

test('capabilities: reports env-only facts without touching the database', async () => {
  const res = capabilitiesRoute.GET();
  assert.deepEqual(await res.json(), { realtime: false, byok: true, engine: 'local' });
  process.env.OPENAI_API_KEY = 'sk-test';
  assert.equal((await capabilitiesRoute.GET().json()).realtime, true);
  delete process.env.OPENAI_API_KEY;
});

test('realtime session: bring-your-own-key header is used, validated and never echoed', async () => {
  resetRateLimit();
  const realFetch = globalThis.fetch;
  let auth;
  globalThis.fetch = async (_url, init) => {
    auth = init.headers.Authorization;
    return new Response(JSON.stringify({ value: 'ek_route', expires_at: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const good = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    const req2 = new Request('http://localhost/api/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '2.2.2.2', 'x-openai-key': good },
      body: JSON.stringify(ctx),
    });
    const res = await sessionRoute.POST(req2);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.clientSecret, 'ek_route');
    assert.equal(auth, `Bearer ${good}`);
    assert.ok(!JSON.stringify(body).includes(good));

    const bad = await sessionRoute.POST(new Request('http://localhost/api/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '2.2.2.3', 'x-openai-key': 'not a key' },
      body: JSON.stringify(ctx),
    }));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'realtime_invalid_key');
  } finally {
    globalThis.fetch = realFetch;
  }
});
