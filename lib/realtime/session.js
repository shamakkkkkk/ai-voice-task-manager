import { createHash } from 'node:crypto';
import { REALTIME_DEFAULTS, buildClientSecretBody, modelCandidates } from './config.js';

const ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';
const KEY_FORMAT = /^[\w.-]{20,300}$/;

export const isPlausibleKey = (k) => typeof k === 'string' && KEY_FORMAT.test(k.trim());

async function upstreamMessage(res) {
  try {
    const data = await res.json();
    return String(data?.error?.message ?? '').replace(/sk-[\w-]+/g, 'sk-…').slice(0, 200);
  } catch {
    return '';
  }
}

const failure = (error, detail = '', status = 502) => ({ ok: false, status, error, detail });

/**
 * Mints a short-lived client secret (ek_…) so the browser can open a WebRTC session directly with OpenAI.
 * The key comes from the server environment or, for "bring your own key" visitors, from `apiKey` (used for this one
 * request and never stored or logged). Failures are classified so the UI can say what is actually wrong:
 *   realtime_unavailable (no key) · realtime_invalid_key (401) · realtime_quota (429) ·
 *   realtime_model (no candidate model accepted) · realtime_upstream (5xx / network)
 */
export async function createClientSecret(ctx, { userId, apiKey, env = process.env, fetchImpl = fetch } = {}) {
  const key = String(apiKey || env.OPENAI_API_KEY || '').trim();
  if (!key) return failure('realtime_unavailable', '', 503);

  const voice = env.OPENAI_REALTIME_VOICE || REALTIME_DEFAULTS.voice;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  // Lets OpenAI attribute abuse to an anonymous end user instead of your whole organisation.
  if (userId) headers['OpenAI-Safety-Identifier'] = createHash('sha256').update(userId).digest('hex').slice(0, 32);

  let last = '';
  try {
    for (const model of modelCandidates(env)) {
      for (const minimal of [false, true]) {
        const res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(buildClientSecretBody(ctx, { model, voice, minimal })),
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          const data = await res.json();
          if (data?.value) return { ok: true, clientSecret: data.value, expiresAt: data.expires_at ?? null, model };
          return failure('realtime_upstream', 'empty response');
        }

        const message = await upstreamMessage(res);
        console.error(`[ai-voice-task-manager] realtime client_secrets: HTTP ${res.status} (${model}${minimal ? ', minimal' : ''}) ${message}`);
        if (res.status === 401) return failure('realtime_invalid_key', message);
        if (res.status === 429) return failure('realtime_quota', message);
        if (res.status >= 500) return failure('realtime_upstream', message);
        last = message;
        if (res.status === 400 && !minimal) continue; // maybe an optional setting was rejected: retry minimal
        break; // 400 (minimal) / 403 / 404: this model is not usable, try the next one
      }
    }
    return failure('realtime_model', last);
  } catch (err) {
    console.error('[ai-voice-task-manager] realtime client_secrets error:', err?.message ?? err);
    return failure('realtime_upstream', err?.name === 'TimeoutError' ? 'timeout' : '');
  }
}
