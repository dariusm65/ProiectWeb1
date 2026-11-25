// Lightweight in-memory fixed-window rate limiter (no external dependency, D-021).
// Suitable for the single-instance deployment; counters reset on process restart.
// `max <= 0` disables the limiter entirely (used by default under NODE_ENV=test).

/**
 * @param {object} options
 * @param {number} options.windowMs  Window length in milliseconds.
 * @param {number} options.max       Max requests per key per window (<= 0 disables).
 * @param {(req) => string} options.keyFn  Derives the bucket key (e.g. authenticated user id).
 * @param {() => number} [options.clock]   Injectable ms clock for deterministic tests.
 * @param {number} [options.maxKeys]       Prune expired buckets once this many keys exist.
 */
export function createRateLimiter({ windowMs, max, keyFn, clock = Date.now, maxKeys = 10000 }) {
  if (!max || max <= 0) {
    return (req, res, next) => next();
  }
  const buckets = new Map();

  return (req, res, next) => {
    const now = clock();
    const key = keyFn(req);

    if (buckets.size >= maxKeys) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k);
      }
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
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
