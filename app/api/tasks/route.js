import { json, route } from '../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ userId, service }) => json({ tasks: await service.list(userId) }));
