import { json, readJson, route } from '../../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ request, context, userId, service }) => {
  const { id } = await context.params;
  const body = await readJson(request);
  if (typeof body?.done !== 'boolean') return json({ error: 'invalid_request' }, 400);
  const tasks = await service.setDone(userId, id, body.done);
  return tasks ? json({ tasks }) : json({ error: 'not_found' }, 404);
});

export const DELETE = route(async ({ context, userId, service }) => {
  const { id } = await context.params;
  const tasks = await service.remove(userId, id);
  return tasks ? json({ tasks }) : json({ error: 'not_found' }, 404);
});
