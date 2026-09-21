import { CommandRequestSchema } from '../../../lib/nlu/schema.js';
import { json, limited, readJson, route } from '../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phrase in (typed or recognised speech) → LLM/local NLU → tasks written to the database → fresh task list out.
export const POST = route(async ({ request, userId, service }) => {
  const blocked = limited(request, 'command', Number(process.env.RATE_LIMIT_PER_MIN) || 30);
  if (blocked) return blocked;

  const parsed = CommandRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  return json(await service.command(userId, parsed.data));
});
