import { createHash } from "crypto";

/**
 * Per-instance sliding-window rate limiter. This is a first, cheap layer only — the binding
 * protections (daily cap, token bucket, idempotency) live in PostgreSQL and hold across instances.
 */
const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, arr] of buckets) if (!arr.length || now - arr[arr.length - 1] > 10 * 60_000) buckets.delete(k);
  }
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

/** Privacy-minimizing network signal: truncated, salted, daily-rotating hash. Raw IPs are never stored. */
export function ipSignal(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${day}:${process.env.SESSION_SECRET ?? process.env.BOT_TOKEN ?? "gop"}:${ip}`).digest("hex").slice(0, 16);
}
