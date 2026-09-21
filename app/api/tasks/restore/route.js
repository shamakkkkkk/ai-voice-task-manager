import { RestoreSchema } from '../../../../lib/nlu/schema.js';
import { json, readJson, route } from '../../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Undo: the client sends the snapshot it held before the last change.
export const POST = route(async ({ request, userId, service }) => {
  const parsed = RestoreSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);
  try {
    return json({ tasks: await service.restore(userId, parsed.data.tasks) });
  } catch {
    return json({ error: 'conflict' }, 409);
  }
});
