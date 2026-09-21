// Quick self-test for Live mode:  npm run check:live   (or: node scripts/check-realtime.mjs sk-...)
// Reads OPENAI_API_KEY from the environment, .env.local or .env, asks OpenAI for an ephemeral Realtime key and
// tells you exactly what is wrong if it fails.
import fs from 'node:fs';
import { createClientSecret } from '../lib/realtime/session.js';
import { modelCandidates } from '../lib/realtime/config.js';

for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const apiKey = process.argv[2] || process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('No key found. Put OPENAI_API_KEY in .env.local or pass it: node scripts/check-realtime.mjs sk-...');
  process.exit(1);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ctx = {
  today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  now: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: 'en',
};

console.log(`Key: ${apiKey.slice(0, 7)}…  Models to try: ${modelCandidates(process.env).join(', ')}`);
const r = await createClientSecret(ctx, { apiKey });
if (r.ok) {
  console.log(`OK. OpenAI accepted model "${r.model}" and issued an ephemeral key. Live mode should work.`);
} else {
  const hints = {
    realtime_invalid_key: 'The key was rejected (HTTP 401). Create a new key at platform.openai.com/api-keys.',
    realtime_quota: 'Rate limit or no credit (HTTP 429). Add billing credit at platform.openai.com/settings/organization/billing.',
    realtime_model: 'None of the Realtime models is available to this key. Set OPENAI_REALTIME_MODEL to a model your account can use.',
    realtime_upstream: 'OpenAI (or the network) did not answer properly. Try again in a minute.',
  };
  console.error(`FAILED: ${r.error}${r.detail ? ` — ${r.detail}` : ''}\n${hints[r.error] ?? ''}`);
  process.exit(2);
}
