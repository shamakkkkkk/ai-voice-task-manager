import { randomUUID } from 'node:crypto';

// Anonymous, cookie-based identity: every browser gets its own private task list without a sign-up.
// (Swap this file for real auth — NextAuth, Clerk, Supabase Auth — and nothing else has to change.)
const COOKIE = 'tm_uid';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TWO_YEARS = 60 * 60 * 24 * 730;

export function readUserId(request) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) {
      const value = rest.join('=');
      return UUID.test(value) ? value.toLowerCase() : null;
    }
  }
  return null;
}

export function cookieHeader(userId, { secure = process.env.NODE_ENV === 'production' } = {}) {
  return `${COOKIE}=${userId}; Path=/; Max-Age=${TWO_YEARS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Runs `handler(userId)` and, for a first-time visitor, attaches the identity cookie to the response. */
export async function withUser(request, handler) {
  let userId = readUserId(request);
  const isNew = !userId;
  if (!userId) userId = randomUUID();
  const response = await handler(userId);
  if (isNew) response.headers.append('Set-Cookie', cookieHeader(userId));
  return response;
}
