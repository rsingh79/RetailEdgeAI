-- AlterTable: Add match correction fields to InvoiceLineMatch
-- These track post-approval corrections (rematch, unmatch, match).
-- Existing isManual/matchedByUserId are preserved — they track the original match method.

ALTER TABLE "InvoiceLineMatch" ADD COLUMN "matchStatus" TEXT DEFAULT 'active';
ALTER TABLE "InvoiceLineMatch" ADD COLUMN "correctedAt" TIMESTAMP(3);
ALTER TABLE "InvoiceLineMatch" ADD COLUMN "correctedBy" TEXT;
ALTER TABLE "InvoiceLineMatch" ADD COLUMN "previousProductId" TEXT;
ALTER TABLE "InvoiceLineMatch" ADD COLUMN "previousVariantId" TEXT;
ALTER TABLE "InvoiceLineMatch" ADD COLUMN "correctionReason" TEXT;
