import cron from 'node-cron';
import { pollFolderForInvoices } from './folder.js';
import { createTenantClient } from '../lib/prisma.js';

let isRunning = false;

/**
 * Start the Folder Polling background scheduler.
 * Runs every 5 minutes and checks which tenant integrations are due for a poll
 * based on their configured `pollIntervalMin`.
 *
 * @param {PrismaClient} prisma - Root (non-tenant-scoped) Prisma client
 */
export function startFolderScheduler(prisma) {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    if (isRunning) return; // Prevent overlapping runs
    isRunning = true;

    try {
      const now = new Date();

      // Find all active folder integrations
      const integrations = await prisma.folderIntegration.findMany({
        where: { isActive: true },
      });

      for (const integration of integrations) {
        // Check if enough time has passed since last poll
        const intervalMs = (integration.pollIntervalMin || 30) * 60 * 1000;
        const nextPollAt = integration.lastPollAt
          ? new Date(integration.lastPollAt.getTime() + intervalMs)
          : new Date(0); // Never polled — do it now

        if (now < nextPollAt) continue;

        try {
          // Find a user in this tenant (for API usage / audit tracking)
          const user = await prisma.user.findFirst({
            where: { tenantId: integration.tenantId },
            select: { id: true },
          });

          if (!user) {
            console.warn(`[Folder Scheduler] No user found for tenant ${integration.tenantId}, skipping`);
            continue;
          }

          console.log(
            `[Folder Scheduler] Polling tenant ${integration.tenantId} (${integration.folderPath})`
          );

          // Create a tenant-scoped client so queries/creates get tenantId injected
          const tenantPrisma = createTenantClient(integration.tenantId);
          const result = await pollFolderForInvoices(
            tenantPrisma,
            integration,
            integration.tenantId,
            user.id
          );

          console.log(
            `[Folder Scheduler] Tenant ${integration.tenantId}: ${JSON.stringify(result)}`
          );
        } catch (err) {
          console.error(
            `[Folder Scheduler] Error polling tenant ${integration.tenantId}:`,
            err.message
          );
        }
      }
    } catch (err) {
      console.error('[Folder Scheduler] Fatal error:', err);
    } finally {
      isRunning = false;
    }
  });

  console.log('[Folder Scheduler] Started — checking every 5 minutes');
}
