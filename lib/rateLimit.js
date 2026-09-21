// Tiny in-memory fixed-window rate limiter. Protects the LLM key on a public deployment.
// On serverless platforms each instance keeps its own counters, so treat it as a best-effort guard.

const buckets = new Map();

export function rateLimit(key, { limit = 20, windowMs = 60_000 } = {}, now = Date.now()) {
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
  }
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfter: Math.ceil((b.reset - now) / 1000) };
}

export function resetRateLimit() {
  buckets.clear();
}
