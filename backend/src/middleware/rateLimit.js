// Lightweight in-memory fixed-window rate limiter (no external dependency, D-021).
// Suitable for the single-instance deployment; counters reset on process restart.
// `max <= 0` disables the limiter entirely (used by default under NODE_ENV=test).

/**
 * @param {object} options
 * @param {number} options.windowMs  Window length in milliseconds.
 * @param {number} options.max       Max requests per key per window (<= 0 disables).
 * @param {(req) => string} options.keyFn  Derives the bucket key (e.g. authenticated user id).
 * @param {() => number} [options.clock]   Injectable ms clock for deterministic tests.
 * @param {number} [options.maxKeys]       Hard cap on active buckets; evicts oldest in O(1).
 */
export function createRateLimiter({ windowMs, max, keyFn, clock = Date.now, maxKeys = 10000 }) {
  if (!max || max <= 0) {
    return (req, res, next) => next();
  }
  const buckets = new Map();
  const sweepIntervalMs = Math.max(1000, Math.min(windowMs, 60_000));
  let lastSweepAt = 0;

  return (req, res, next) => {
    const now = clock();
    const key = keyFn(req);

    let bucket = buckets.get(key);
    if (bucket && bucket.resetAt <= now) {
      buckets.delete(key);
      bucket = undefined;
    }

    if (!bucket && buckets.size >= maxKeys) {
      // Throttled expired-entry sweep so we never do an O(N) full scan on every request
      if (now - lastSweepAt >= sweepIntervalMs) {
        lastSweepAt = now;
        for (const [k, b] of buckets) {
          if (b.resetAt <= now) buckets.delete(k);
        }
      }
      // Hard cap: evict oldest insertion-ordered key in O(1) if still at capacity
      while (buckets.size >= maxKeys) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey === undefined) break;
        buckets.delete(oldestKey);
      }
    }

    if (!bucket) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
      });
    }
    return next();
  };
}
