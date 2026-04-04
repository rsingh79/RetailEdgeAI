import cron from 'node-cron';
import { syncOrders } from './shopify.js';
import { createTenantClient, adminPrisma } from '../lib/prisma.js';

let isRunning = false;

/**
 * Start the Shopify daily auto-sync scheduler.
 * Runs daily at 2:00 AM UTC. Only syncs tenants that have:
 *   - autoSyncEnabled = true (explicit user consent)
 *   - lastSyncAt != null (completed initial historical import)
 *
 * Each tenant syncs independently — a failure in one never blocks others.
 */
export function startShopifySyncScheduler() {
  cron.schedule('0 2 * * *', async () => {
    if (isRunning) return; // prevent overlapping runs
    isRunning = true;

    console.log('[ShopifySyncScheduler] Starting daily auto-sync...');
    const startTime = Date.now();
    let processed = 0;
    let failed = 0;

    try {
      const integrations = await adminPrisma.shopifyIntegration.findMany({
        where: {
          autoSyncEnabled: true,
          isActive: true,
          lastSyncAt: { not: null },
        },
      });

      for (const integration of integrations) {
        try {
          const prisma = createTenantClient(integration.tenantId);
          await syncOrders(prisma, integration.tenantId, {
            sinceDate: integration.lastSyncAt,
          });

          // Update bookmark on success
          await adminPrisma.shopifyIntegration.update({
            where: { id: integration.id },
            data: { lastSyncAt: new Date(), syncStatus: 'completed' },
          });

          processed++;
        } catch (err) {
          failed++;
          console.error(
            `[ShopifySyncScheduler] Failed for tenant ${integration.tenantId}:`,
            err.message,
          );
          // Mark as failed but do NOT update lastSyncAt — next run retries from same point
          try {
            await adminPrisma.shopifyIntegration.update({
              where: { id: integration.id },
              data: { syncStatus: 'failed' },
            });
          } catch { /* best-effort */ }
        }
      }
    } catch (err) {
      console.error('[ShopifySyncScheduler] Scheduler error:', err);
    } finally {
      isRunning = false;
      const durationMs = Date.now() - startTime;
      console.log(
        `[ShopifySyncScheduler] Complete: ${processed} synced, ${failed} failed (${durationMs}ms)`,
      );
    }
  });

  console.log('[ShopifySyncScheduler] Scheduled daily auto-sync at 02:00 UTC');
}

/**
 * Run auto-sync for all eligible tenants immediately (for testing / manual trigger).
 */
export async function runDailyAutoSync() {
  const integrations = await adminPrisma.shopifyIntegration.findMany({
    where: {
      autoSyncEnabled: true,
      isActive: true,
      lastSyncAt: { not: null },
    },
  });

  const results = [];
  for (const integration of integrations) {
    try {
      const prisma = createTenantClient(integration.tenantId);
      const stats = await syncOrders(prisma, integration.tenantId, {
        sinceDate: integration.lastSyncAt,
      });

      await adminPrisma.shopifyIntegration.update({
        where: { id: integration.id },
        data: { lastSyncAt: new Date(), syncStatus: 'completed' },
      });

      results.push({ tenantId: integration.tenantId, status: 'success', stats });
    } catch (err) {
      try {
        await adminPrisma.shopifyIntegration.update({
          where: { id: integration.id },
          data: { syncStatus: 'failed' },
        });
      } catch { /* best-effort */ }
      results.push({ tenantId: integration.tenantId, status: 'failed', error: err.message });
    }
  }

  return results;
}
