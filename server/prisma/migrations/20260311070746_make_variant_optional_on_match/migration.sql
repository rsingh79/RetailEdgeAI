-- DropForeignKey
ALTER TABLE "InvoiceLineMatch" DROP CONSTRAINT "InvoiceLineMatch_productVariantId_fkey";

-- AlterTable
ALTER TABLE "InvoiceLineMatch" ADD COLUMN     "productId" TEXT,
ALTER COLUMN "productVariantId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "InvoiceLineMatch_productId_idx" ON "InvoiceLineMatch"("productId");

-- AddForeignKey
ALTER TABLE "InvoiceLineMatch" ADD CONSTRAINT "InvoiceLineMatch_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineMatch" ADD CONSTRAINT "InvoiceLineMatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
