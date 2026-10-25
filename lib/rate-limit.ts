import "server-only";
import { AppError } from "@/lib/errors";

// ponytail: in-memory fixed window per server instance. Good enough to stop runaway clients and
// double-submits; on multi-instance hosting swap for a shared store (e.g. Upstash Redis) if abuse appears.
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return;
  }
  b.count += 1;
  if (b.count > limit) throw new AppError("RATE_LIMITED", { retry_after_seconds: Math.ceil((b.resetAt - now) / 1000) });
}
