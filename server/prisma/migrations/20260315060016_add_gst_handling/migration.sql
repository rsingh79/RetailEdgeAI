-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "gstInclusive" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "gstAlloc" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "gstInclusive" BOOLEAN NOT NULL DEFAULT false;
