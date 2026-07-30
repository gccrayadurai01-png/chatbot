/**
 * In-process sliding-window rate limiter.
 *
 * Adequate for a single-instance MVP only. On Vercel or any multi-instance
 * deploy each instance keeps its own counters, so the effective limit is
 * `limit x instances` — move to Redis / Vercel KV before launch if abuse of the
 * chat endpoint is a real concern (every allowed request costs Claude tokens).
 */
const buckets = new Map<string, number[]>();

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  const hits = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);

  if (hits.length >= limit) {
    const oldest = hits[0]!;
    buckets.set(key, hits);
    return { allowed: false, retryAfterSeconds: Math.ceil((oldest + windowMs - now) / 1000) };
  }

  hits.push(now);
  buckets.set(key, hits);

  // Opportunistic cleanup so the map doesn't grow without bound.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) {
      if (v.every((ts) => ts <= cutoff)) buckets.delete(k);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Best-effort client IP from proxy headers. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
