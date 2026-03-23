/**
 * In-memory rate limiter for chat messages.
 * Limits messages per tenant per minute to prevent abuse and control API costs.
 *
 * Note: In-memory works fine for single-server deployments.
 * For multi-server, replace with Redis-based rate limiting.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_MESSAGES = 10; // 10 messages per minute per tenant

// Map<tenantId, timestamp[]>
const tenantWindows = new Map();

// Cleanup old entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [tenantId, timestamps] of tenantWindows) {
    const valid = timestamps.filter((t) => now - t < WINDOW_MS);
    if (valid.length === 0) {
      tenantWindows.delete(tenantId);
    } else {
      tenantWindows.set(tenantId, valid);
    }
  }
}, 5 * 60_000);

/**
 * Express middleware: rate limit chat messages per tenant.
 */
export function chatRateLimit(req, res, next) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return next();

  const now = Date.now();
  let timestamps = tenantWindows.get(tenantId) || [];

  // Remove timestamps outside the window
  timestamps = timestamps.filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_MESSAGES) {
    const oldestInWindow = timestamps[0];
    const retryAfterSec = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);

    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Maximum ${MAX_MESSAGES} messages per minute. Try again in ${retryAfterSec}s.`,
      retryAfterSec,
    });
  }

  timestamps.push(now);
  tenantWindows.set(tenantId, timestamps);
  next();
}
