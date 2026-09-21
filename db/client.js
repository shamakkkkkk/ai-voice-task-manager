import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { DDL } from './ddl.js';

/**
 * DATABASE_URL:
 *   file:./data/tasks.db           local SQLite file (default; Docker uses a volume)
 *   libsql://<db>.turso.io        Turso — SQLite in the cloud, use this on Vercel
 * Without a URL on Vercel we fall back to /tmp, which works but is wiped on every cold start.
 */
export function resolveDbConfig(env = process.env) {
  const url = env.DATABASE_URL || (env.VERCEL ? 'file:/tmp/tasks.db' : 'file:./data/tasks.db');
  const local = url.startsWith('file:');
  return { url, authToken: env.DATABASE_AUTH_TOKEN || undefined, local, persistent: !(local && !env.DATABASE_URL && env.VERCEL) };
}

const g = globalThis;

function open() {
  const cfg = resolveDbConfig();
  if (cfg.local) {
    const file = cfg.url.slice('file:'.length);
    if (file && file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const client = createClient({ url: cfg.url, authToken: cfg.authToken });
  return client.executeMultiple(DDL).then(() => ({ client, db: drizzle({ client, schema }), cfg }));
}

/** One connection per server process (survives hot reloads in dev). */
export function getConnection() {
  if (!g.__taskDb) {
    g.__taskDb = open();
    g.__taskDb.catch(() => {
      g.__taskDb = undefined; // let the next request retry
    });
  }
  return g.__taskDb;
}

export async function getDb() {
  return (await getConnection()).db;
}
