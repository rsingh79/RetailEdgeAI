-- Stripe Billing Integration
-- Adds Stripe subscription management fields to the Tenant model.

-- ══════════════════════════════════════════════════════════════
-- Tenant: Stripe billing fields
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "Tenant" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "billingPeriodStart" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "billingPeriodEnd" TIMESTAMP(3);

-- Trial management fields
ALTER TABLE "Tenant" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "trialTier" TEXT DEFAULT 'growth';
ALTER TABLE "Tenant" ADD COLUMN "hasTrialExpired" BOOLEAN NOT NULL DEFAULT false;

-- Configurable grace period (per-tenant override)
ALTER TABLE "Tenant" ADD COLUMN "gracePeriodDays" INTEGER;
ALTER TABLE "Tenant" ADD COLUMN "gracePeriodEndsAt" TIMESTAMP(3);

-- Unique index on stripeCustomerId (only one tenant per Stripe customer)
CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");

-- ══════════════════════════════════════════════════════════════
-- PlatformSettings: update default grace period from 3 to 14 days
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "PlatformSettings" ALTER COLUMN "gracePeriodDays" SET DEFAULT 14;

-- Update existing singleton row if it has the old default
UPDATE "PlatformSettings" SET "gracePeriodDays" = 14 WHERE "id" = 'singleton' AND "gracePeriodDays" = 3;

-- ══════════════════════════════════════════════════════════════
-- Backfill trialStartedAt for existing trial tenants
-- ══════════════════════════════════════════════════════════════

UPDATE "Tenant"
SET "trialStartedAt" = "createdAt"
WHERE "subscriptionStatus" = 'trial' AND "trialStartedAt" IS NULL;
