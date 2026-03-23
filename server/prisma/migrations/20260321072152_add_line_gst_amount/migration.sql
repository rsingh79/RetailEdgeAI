-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "lineGstAmount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "hasPerLineGst" BOOLEAN NOT NULL DEFAULT false;
