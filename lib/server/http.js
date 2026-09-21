import { NextResponse } from 'next/server';
import { getService } from './container.js';
import { rateLimit } from '../rateLimit.js';
import { withUser } from './user.js';

export const json = (body, status = 200, headers = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

const clientIp = (request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'anonymous';

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export function limited(request, bucket, limit) {
  const r = rateLimit(`${bucket}:${clientIp(request)}`, { limit });
  return r.ok ? null : json({ error: 'rate_limited' }, 429, { 'Retry-After': String(r.retryAfter) });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * Wraps a route: identifies the (anonymous) user, gives the handler a ready TaskService,
 * and turns unexpected failures into a clean 500 instead of a stack trace.
 */
export function route(handler) {
  return async (request, context) => {
    try {
      return await withUser(request, async (userId) => {
        return handler({ request, context, userId, service: await getService() });
      });
    } catch (err) {
      console.error('[ai-voice-task-manager] request failed:', err);
      return json({ error: 'server_error' }, 500);
    }
  };
}
