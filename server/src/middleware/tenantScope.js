import { createTenantClient } from '../lib/prisma.js';

/**
 * Express middleware that creates a tenant-scoped Prisma client.
 *
 * Must run AFTER the `authenticate` middleware (which sets req.user).
 * Sets:
 *   - req.tenantId  — convenience shorthand
 *   - req.prisma    — Prisma client scoped to the authenticated tenant
 *
 * Routes use `req.prisma` instead of importing a global prisma client,
 * ensuring every query is automatically filtered by tenantId.
 */
export function tenantScope(req, res, next) {
  if (!req.user?.tenantId) {
    return res.status(403).json({ message: 'No tenant context available' });
  }

  if (!/^[a-z0-9]+$/i.test(req.user.tenantId)) {
    return res.status(403).json({ message: 'Invalid tenant context' });
  }

  req.tenantId = req.user.tenantId;
  req.prisma = createTenantClient(req.user.tenantId);
  next();
}
