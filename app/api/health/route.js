import { NextResponse } from 'next/server';
import { getConnection } from '../../../db/client.js';
import { pickProvider } from '../../../lib/nlu/llm.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const base = { engine: pickProvider() ?? 'local', realtime: Boolean(process.env.OPENAI_API_KEY) };
  try {
    const { client, cfg } = await getConnection();
    await client.execute('SELECT 1');
    return NextResponse.json({ ok: true, ...base, db: { ok: true, kind: cfg.local ? 'sqlite-file' : 'libsql-remote', persistent: cfg.persistent } });
  } catch (err) {
    console.error('[ai-voice-task-manager] health check failed:', err?.message ?? err);
    return NextResponse.json({ ok: false, ...base, db: { ok: false } }, { status: 503 });
  }
}
