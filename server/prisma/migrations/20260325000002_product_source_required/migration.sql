-- Backfill existing products that have no source
UPDATE "Product" SET "source" = 'Manual' WHERE "source" IS NULL;

-- Make source non-nullable with a default
ALTER TABLE "Product" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "source" SET DEFAULT 'Manual';
