import { ClientContextSchema } from '../../../../lib/nlu/schema.js';
import { TOOL_NAMES } from '../../../../lib/realtime/config.js';
import { json, limited, readJson, route } from '../../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Step 2: the model called a function (add_task, …). The browser forwards it here; we run it against the database
// and return the result to give back to the model, plus the fresh task list for the UI.
export const POST = route(async ({ request, userId, service }) => {
  const blocked = limited(request, 'rt-tool', 90);
  if (blocked) return blocked;

  const body = await readJson(request);
  const ctx = ClientContextSchema.safeParse(body);
  const args = body?.args;
  if (!ctx.success || !TOOL_NAMES.includes(body?.name) || (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args)))) {
    return json({ error: 'invalid_request' }, 400);
  }

  const result = await service.tool(userId, { name: body.name, args: args ?? {}, today: ctx.data.today, now: ctx.data.now });
  return json(result);
});
