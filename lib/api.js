// Thin browser-side client for the app's own API. Every call returns parsed JSON or throws.
const JSON_HEADERS = { 'content-type': 'application/json' };

async function call(url, init = {}, timeout = 15_000) {
  const res = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(timeout), ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => null); // our routes answer { error, detail? }
    throw Object.assign(new Error(`http_${res.status}`), { status: res.status, code: body?.error, detail: body?.detail });
  }
  return res.json();
}

const post = (url, body, timeout, headers = {}) =>
  call(url, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) }, timeout);

export const api = {
  health: () => call('/api/health', {}, 8000),
  capabilities: () => call('/api/capabilities', {}, 8000),
  tasks: () => call('/api/tasks'),
  command: (body) => post('/api/command', body, 20_000),
  setDone: (id, done) => call(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ done }) }),
  remove: (id) => call(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restore: (tasks) => post('/api/tasks/restore', { tasks }),
  clearDone: () => post('/api/tasks/clear-done', {}),
  // `apiKey` is a visitor's own OpenAI key (bring-your-own-key); the server uses it for this request only.
  realtimeSession: (ctx, apiKey) => post('/api/realtime/session', ctx, 25_000, apiKey ? { 'x-openai-key': apiKey } : {}),
  realtimeTool: (body) => post('/api/realtime/tool', body, 15_000),
};
