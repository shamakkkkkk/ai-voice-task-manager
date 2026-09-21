import { NextResponse } from 'next/server';
import { pickProvider } from '../../../lib/nlu/llm.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Environment-only (no database access), so the UI can decide what to offer even if the database is down.
export function GET() {
  return NextResponse.json(
    { realtime: Boolean(process.env.OPENAI_API_KEY), byok: true, engine: pickProvider() ?? 'local' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
