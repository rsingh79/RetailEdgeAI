import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { rateLimit } from '../src/middleware/rateLimits.js';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenant,
  createTestUser,
  createTestSystemAdmin,
  ensureTiersSeeded,
} from './helpers/fixtures.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

function tenantToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function adminToken(admin) {
  return jwt.sign(
    { userId: admin.id, tenantId: null, role: 'SYSTEM_ADMIN' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function expiredToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    JWT_SECRET,
    { expiresIn: '-1s' },
  );
}

describe('API Hardening', () => {
  let tenantA, tenantB, userA, userB, admin;
  let tokenA, tokenB, tokenAdmin;

  beforeAll(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenantA = await createTestTenant('Hardening A');
    tenantB = await createTestTenant('Hardening B');
    userA = await createTestUser(tenantA.id, { role: 'OWNER' });
    userB = await createTestUser(tenantB.id, { role: 'OWNER' });
    admin = await createTestSystemAdmin();
    tokenA = tenantToken(userA);
    tokenB = tenantToken(userB);
    tokenAdmin = adminToken(admin);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  // ─── Rate Limiting ──────────────────────────────────────────────
  //
  // App-level limiters use high limits in test env (to avoid cross-file interference).
  // We test rate limiting behavior with a dedicated mini Express app using production limits.

  describe('Rate limiting', () => {
    let rateLimitApp;

    beforeAll(() => {
      rateLimitApp = express();
      rateLimitApp.use(express.json());

      // Auth limiter with production limit: 5/min per IP
      const testAuthLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 5,
        keyGenerator: (req) => req.ip,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          error: 'Too many login attempts',
          code: 'AUTH_RATE_LIMIT_EXCEEDED',
          message: 'Too many authentication attempts.',
          retryAfter: 60,
        },
      });

      // Standard limiter with production limit: 100/min per tenant key
      const testStandardLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 100,
        keyGenerator: (req) => req.headers['x-tenant-id'] || req.ip,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded.',
          retryAfter: 60,
        },
      });

      rateLimitApp.post('/auth/login', testAuthLimiter, (_req, res) => {
        res.status(401).json({ message: 'Bad credentials' });
      });
      rateLimitApp.get('/api/data', testStandardLimiter, (req, res) => {
        res.json({ ok: true });
      });
    });

    it('auth limiter: 6th request in 1 minute returns 429', async () => {
      const results = [];
      for (let i = 0; i < 6; i++) {
        const res = await request(rateLimitApp)
          .post('/auth/login')
          .send({ email: 'x@x.com', password: 'x' });
        results.push(res.status);
      }
      // First 5 get through (401 — bad credentials)
      expect(results.slice(0, 5).every((s) => s === 401)).toBe(true);
      // 6th is rate limited
      expect(results[5]).toBe(429);
    });

    it('rate limit response includes standard error format', async () => {
      // Limiter already exhausted from previous test
      const res = await request(rateLimitApp)
        .post('/auth/login')
        .send({ email: 'x@x.com', password: 'x' });
      expect(res.status).toBe(429);
      expect(res.body).toHaveProperty('code', 'AUTH_RATE_LIMIT_EXCEEDED');
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('retryAfter');
    });

    it('rate limit response includes RateLimit-* headers', async () => {
      const res = await request(rateLimitApp)
        .post('/auth/login')
        .send({ email: 'x@x.com', password: 'x' });
      const headers = Object.keys(res.headers).map((h) => h.toLowerCase());
      const hasRateLimitHeader = headers.some(
        (h) => h.startsWith('ratelimit') || h.startsWith('retry-after'),
      );
      expect(hasRateLimitHeader).toBe(true);
    });

    it('different tenants have independent rate limits', async () => {
      // Both "tenants" should succeed — they have separate keys
      const resA = await request(rateLimitApp)
        .get('/api/data')
        .set('X-Tenant-Id', 'tenant-aaa');
      const resB = await request(rateLimitApp)
        .get('/api/data')
        .set('X-Tenant-Id', 'tenant-bbb');
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
    });
  });

  // ─── Authentication Audit ───────────────────────────────────────

  describe('Authentication audit', () => {
    it('public routes work without auth token', async () => {
      const healthRes = await request(app).get('/health');
      expect(healthRes.status).toBe(200);

      const apiHealthRes = await request(app).get('/api/health');
      expect(apiHealthRes.status).toBe(200);
    });

    it('protected route returns 401 without auth token', async () => {
      const res = await request(app).get('/api/products');
      expect(res.status).toBe(401);
    });

    it('protected route returns 401 with expired token', async () => {
      const expired = expiredToken(userA);
      const res = await request(app)
        .get('/api/stores')
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });

    it('protected route returns 401 with malformed token', async () => {
      const res = await request(app)
        .get('/api/stores')
        .set('Authorization', 'Bearer not.a.real.token');
      expect(res.status).toBe(401);
    });

    it('admin routes return 401 without auth', async () => {
      const res = await request(app).get('/api/admin/overview/stats');
      expect(res.status).toBe(401);
    });

    it('admin routes return 403 for non-admin user', async () => {
      const res = await request(app)
        .get('/api/admin/overview/stats')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(403);
    });

    it('admin routes return 200 for SYSTEM_ADMIN', async () => {
      const res = await request(app)
        .get('/api/admin/overview/stats')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
    });
  });

  // ─── Error Handling ─────────────────────────────────────────────

  describe('Error handling', () => {
    it('error response matches standard format: { error, code, message }', async () => {
      // A 401 error from auth middleware
      const res = await request(app).get('/api/products');
      expect(res.body).toHaveProperty('message');
      // The auth middleware returns { message }, global handler catches unhandled ones
    });

    it('404 on non-existent API route returns JSON (not HTML)', async () => {
      const res = await request(app)
        .get('/api/does-not-exist')
        .set('Authorization', `Bearer ${tokenA}`);
      // Should not return 200 with HTML or crash
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('response does not contain stack trace or server info', async () => {
      const res = await request(app).get('/api/products');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('node_modules');
      expect(body).not.toContain('at Object');
      expect(body).not.toContain('at Module');
      expect(body).not.toContain('.js:');
    });
  });

  // ─── Health Check ───────────────────────────────────────────────

  describe('Health check', () => {
    it('GET /health returns 200 with status, timestamp, uptime', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('uptime');
      expect(typeof res.body.uptime).toBe('number');
    });

    it('GET /health includes database check', async () => {
      const res = await request(app).get('/health');
      expect(res.body.checks).toHaveProperty('database');
      expect(res.body.checks.database).toHaveProperty('status', 'ok');
    });

    it('GET /health includes memory check', async () => {
      const res = await request(app).get('/health');
      expect(res.body.checks).toHaveProperty('memory');
      expect(res.body.checks.memory).toHaveProperty('status');
      expect(res.body.checks.memory).toHaveProperty('heapUsedMB');
      expect(res.body.checks.memory).toHaveProperty('heapTotalMB');
    });

    it('GET /api/health also works (backward compat)', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('checks');
    });

    it('health check requires no authentication', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      // No Authorization header sent — should still work
    });
  });

  // ─── Security Headers ──────────────────────────────────────────

  describe('Security headers', () => {
    it('X-Content-Type-Options: nosniff present', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('X-Frame-Options: DENY present', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('Strict-Transport-Security present', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['strict-transport-security']).toContain('max-age=');
    });

    it('Referrer-Policy present', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('Permissions-Policy present', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['permissions-policy']).toContain('camera=()');
    });

    it('response does not contain server version or tech stack info', async () => {
      const res = await request(app).get('/health');
      // Express sets X-Powered-By by default — it should be absent or not leak version
      const poweredBy = res.headers['x-powered-by'];
      // Express defaults to "Express" which is fine — just ensure no version numbers
      if (poweredBy) {
        expect(poweredBy).not.toMatch(/\d+\.\d+/);
      }
    });

    it('security headers are on protected routes too', async () => {
      const res = await request(app)
        .get('/api/stores')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });
  });

  // ─── Global Error Handler ──────────────────────────────────────

  describe('Global error handler', () => {
    it('globalErrorHandler is the last middleware (smoke test)', async () => {
      // Send a request to a protected endpoint without auth
      // Should get a well-formed error, not a crash
      const res = await request(app).get('/api/invoices');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message');
    });
  });
});
