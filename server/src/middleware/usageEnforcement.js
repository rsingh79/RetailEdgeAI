import { adminPrisma } from '../lib/prisma.js';
import { checkCapacity, incrementUsage, getCurrentUsage } from '../services/usageTracker.js';
import { isUnlimited } from '../config/tierLimits.js';

// ── Product Import Enforcement ──────────────────────────────
// Products use check-before, increment-after pattern:
//   1. Call checkProductCapacity() after parsing to verify the batch fits
//   2. Call recordProductsCreated() after the pipeline succeeds

/**
 * Pre-flight check: will this batch of products exceed the catalog limit?
 * Called from within the /import/confirm handler after parsing the file,
 * NOT as middleware (batch size is unknown until the file is parsed).
 *
 * @param {object} prisma - tenant-scoped prisma client
 * @param {string} tenantId
 * @param {number} currentCatalogCount - from product.count({ where: { archivedAt: null } })
 * @param {number} batchSize - number of products in this import
 * @returns {{ allowed, currentCount, limit, remaining, message? }}
 */
export async function checkProductCapacity(prisma, tenantId, currentCatalogCount, batchSize) {
  const usage = await getCurrentUsage(prisma, tenantId);
  const limit = usage.productsLimit;

  if (isUnlimited(limit)) {
    return { allowed: true, currentCount: currentCatalogCount, limit: -1, remaining: Infinity };
  }

  const remaining = Math.max(0, limit - currentCatalogCount);
  const allowed = currentCatalogCount + batchSize <= limit;

  if (!allowed) {
    const tierName = await _getTierName(tenantId);
    return {
      allowed: false,
      currentCount: currentCatalogCount,
      limit,
      remaining,
      importSize: batchSize,
      message:
        `Your ${tierName} plan includes ${limit} products. ` +
        `You currently have ${currentCatalogCount} and this import contains ${batchSize} products. ` +
        `You can import up to ${remaining} more, or upgrade for a higher limit.`,
    };
  }

  return { allowed: true, currentCount: currentCatalogCount, limit, remaining };
}

/**
 * Post-success increment: record how many products were actually created.
 * Called from the /import/confirm handler after runImportPipeline succeeds.
 *
 * Updates TenantUsage.productsImported to reflect the current catalog count
 * (not an increment — a set to the actual count, since products can also be
 * deleted/archived outside of imports).
 */
export async function recordProductsCreated(prisma, tenantId, actualCatalogCount) {
  const usage = await getCurrentUsage(prisma, tenantId);
  try {
    await adminPrisma.tenantUsage.update({
      where: { id: usage.id },
      data: { productsImported: actualCatalogCount },
    });
  } catch (err) {
    // Fire-and-forget — never block the import response
    console.warn('[UsageEnforcement] Failed to record product count:', err.message);
  }
}

// ── Integration Limit Enforcement ───────────────────────────
// Middleware: blocks new integration connections when at the tier's max.
// Applied to initiation routes (auth-url, configure), NOT OAuth callbacks.

/**
 * Middleware factory: returns 429 if the tenant has reached their integration limit.
 * Counts active integrations across all four types (Shopify, Gmail, Drive, Folder).
 *
 * @param {string} currentType - The integration type being configured:
 *   'shopify' | 'gmail' | 'drive' | 'folder'.
 *   If this type already exists for the tenant, it's a reconfiguration (not a new
 *   connection) and the check is skipped — you can always reconfigure what you have.
 */
export function enforceIntegrationLimit(currentType) {
  return (req, res, next) => {
    _enforceIntegrationLimitAsync(req, res, next, currentType).catch((err) => {
      console.error('[UsageEnforcement] Integration limit check failed:', err);
      // On failure, allow through — don't block integrations on an internal error
      next();
    });
  };
}

async function _enforceIntegrationLimitAsync(req, res, next, currentType) {
  if (req.user.role === 'SYSTEM_ADMIN') return next();

  const tenantId = req.user.tenantId;
  if (!tenantId) return res.status(403).json({ message: 'No tenant context' });

  const usage = await getCurrentUsage(null, tenantId);
  const limit = usage.integrationsLimit;

  if (isUnlimited(limit)) return next();

  // Count active integrations across all types
  const [shopify, gmail, folder, drive] = await Promise.all([
    adminPrisma.shopifyIntegration.count({ where: { tenantId, isActive: true } }),
    adminPrisma.gmailIntegration.count({ where: { tenantId, isActive: true } }),
    adminPrisma.folderIntegration.count({ where: { tenantId, isActive: true } }),
    adminPrisma.driveIntegration.count({ where: { tenantId } }),
  ]);

  const activeCount = shopify + gmail + folder + drive;

  // Update the usage record with actual count
  try {
    await adminPrisma.tenantUsage.update({
      where: { id: usage.id },
      data: { integrationsUsed: activeCount },
    });
  } catch { /* best-effort sync */ }

  // If this integration type already exists, this is a reconfiguration — allow through
  const existsMap = { shopify, gmail, folder, drive };
  if (currentType && existsMap[currentType] > 0) {
    req.integrationUsage = { activeCount, limit, remaining: limit - activeCount };
    return next();
  }

  if (activeCount >= limit) {
    const tierName = await _getTierName(tenantId);
    const connected = _describeConnected(shopify, gmail, folder, drive);
    return res.status(429).json({
      message:
        `Your ${tierName} plan includes ${limit} integration${limit !== 1 ? 's' : ''}. ` +
        `You're currently connected to ${connected}. ` +
        `Upgrade to connect more integrations.`,
      code: 'INTEGRATION_LIMIT_REACHED',
      activeCount,
      limit,
      upgradeUrl: '/settings/billing',
    });
  }

  req.integrationUsage = { activeCount, limit, remaining: limit - activeCount };
  next();
}

// ── Helpers ──────────────────────────────────────────────────

async function _getTierName(tenantId) {
  const tenant = await adminPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { planTier: { select: { name: true } }, plan: true },
  });
  return tenant?.planTier?.name || tenant?.plan || 'current';
}

function _describeConnected(shopify, gmail, folder, drive) {
  const parts = [];
  if (shopify) parts.push('Shopify');
  if (gmail) parts.push('Gmail');
  if (folder) parts.push('Folder Polling');
  if (drive) parts.push(`Google Drive`);
  return parts.length > 0 ? parts.join(', ') : 'no integrations';
}
