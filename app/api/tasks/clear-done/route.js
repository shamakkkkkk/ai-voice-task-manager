import { json, route } from '../../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ userId, service }) => json({ tasks: await service.clearDone(userId) }));
