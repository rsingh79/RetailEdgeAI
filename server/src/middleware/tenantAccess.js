import { basePrisma } from '../lib/prisma.js';

/**
 * Middleware that blocks requests from locked tenants.
 *
 * Must run AFTER `authenticate` (which sets req.user).
 * Checks the tenant's isLocked flag and returns 403 if locked.
 * SYSTEM_ADMIN users bypass this check entirely.
 */
export function tenantAccess(req, res, next) {
  // SYSTEM_ADMIN has no tenant — always allowed through
  if (req.user.role === 'SYSTEM_ADMIN') {
    return next();
  }

  if (!req.user.tenantId) {
    return res.status(403).json({ message: 'No tenant context' });
  }

  basePrisma.tenant
    .findUnique({
      where: { id: req.user.tenantId },
      select: { isLocked: true, lockReason: true },
    })
    .then((tenant) => {
      if (!tenant) {
        return res.status(404).json({ message: 'Tenant not found' });
      }
      if (tenant.isLocked) {
        return res.status(403).json({
          message: 'Account access has been suspended',
          reason:
            tenant.lockReason || 'Contact support for more information',
          code: 'TENANT_LOCKED',
        });
      }
      next();
    })
    .catch(() => {
      res.status(500).json({ message: 'Access check failed' });
    });
}
