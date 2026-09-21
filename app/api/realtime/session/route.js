import { ClientContextSchema } from '../../../../lib/nlu/schema.js';
import { createClientSecret, isPlausibleKey } from '../../../../lib/realtime/session.js';
import { json, limited, readJson } from '../../../../lib/server/http.js';
import { withUser } from '../../../../lib/server/user.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Step 1 of a Live session: hand the browser a short-lived OpenAI client secret.
// Visitors without a server-side key can send their own in the X-OpenAI-Key header ("bring your own key").
export async function POST(request) {
  const blocked = limited(request, 'rt-session', 6);
  if (blocked) return blocked;

  const parsed = ClientContextSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  const userKey = request.headers.get('x-openai-key')?.trim() || '';
  if (userKey && !isPlausibleKey(userKey)) return json({ error: 'realtime_invalid_key', detail: 'That does not look like an OpenAI API key.' }, 400);

  return withUser(request, async (userId) => {
    const r = await createClientSecret(parsed.data, { userId, apiKey: userKey || undefined });
    if (!r.ok) return json({ error: r.error, detail: r.detail }, r.status);
    return json({ clientSecret: r.clientSecret, expiresAt: r.expiresAt, model: r.model });
  });
}
