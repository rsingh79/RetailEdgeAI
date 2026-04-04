import { Router } from 'express';
import { adminPrisma } from '../lib/prisma.js';

const router = Router();

/**
 * GET /health
 * Public health check endpoint — no authentication required.
 * Returns service status, uptime, database connectivity, and memory usage.
 */
router.get('/', async (_req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {},
  };

  // Database connectivity
  try {
    await adminPrisma.$queryRaw`SELECT 1`;
    health.checks.database = { status: 'ok' };
  } catch {
    health.status = 'degraded';
    health.checks.database = { status: 'error', message: 'Database unreachable' };
  }

  // Memory usage
  const mem = process.memoryUsage();
  health.checks.memory = {
    status: mem.heapUsed / mem.heapTotal > 0.9 ? 'warning' : 'ok',
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
  };

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;
