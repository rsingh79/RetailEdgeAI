-- Add sales data sync fields to ShopifyIntegration
-- Supports three-mode sync: historical import, manual catch-up, daily auto-sync.

ALTER TABLE "ShopifyIntegration"
  ADD COLUMN "historicalSyncMonths" INTEGER,
  ADD COLUMN "historicalSyncedAt" TIMESTAMP(3),
  ADD COLUMN "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoSyncConsentedAt" TIMESTAMP(3),
  ADD COLUMN "syncStatus" TEXT DEFAULT 'not_started';
