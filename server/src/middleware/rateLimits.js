import rateLimit from 'express-rate-limit';

// Re-export for tests that need to create custom limiter instances
export { rateLimit };

const isTest = process.env.NODE_ENV === 'test';

// Key generator: rate limit per tenant (authenticated routes)
// or per IP (unauthenticated routes like auth, webhooks)
function tenantKey(req) {
  return req.tenantId || req.ip;
}

function ipKey(req) {
  return req.ip;
}

// Standard API: 100 requests/minute per tenant
export const standardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 10_000 : 100,
  keyGenerator: tenantKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'You have exceeded the rate limit. Please wait a moment and try again.',
    retryAfter: 60,
  },
});

// AI query endpoints: 10 requests/minute per tenant
// Tighter limit to prevent runaway API costs
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 10_000 : 10,
  keyGenerator: tenantKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many AI requests',
    code: 'AI_RATE_LIMIT_EXCEEDED',
    message: 'AI queries are limited to 10 per minute. Please wait before submitting another query.',
    retryAfter: 60,
  },
});

// Authentication endpoints: 5 attempts/minute per IP
// Brute force protection
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 10_000 : 5,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: {
    error: 'Too many login attempts',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
    message: 'Too many authentication attempts. Please wait 1 minute before trying again.',
    retryAfter: 60,
  },
});

// Webhook endpoints: 50 requests/minute per IP
// Shopify and Stripe send bursts during sync
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 10_000 : 50,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many webhook requests',
    code: 'WEBHOOK_RATE_LIMIT_EXCEEDED',
    message: 'Webhook rate limit exceeded.',
    retryAfter: 60,
  },
});

// Import endpoints: 5 requests/minute per tenant
// Large imports are expensive — prevent rapid-fire
export const importLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 10_000 : 5,
  keyGenerator: tenantKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many import requests',
    code: 'IMPORT_RATE_LIMIT_EXCEEDED',
    message: 'Please wait before starting another import.',
    retryAfter: 60,
  },
});
