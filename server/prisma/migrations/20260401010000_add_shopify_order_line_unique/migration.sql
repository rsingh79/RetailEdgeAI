-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrderLine_orderId_shopifyLineId_key" ON "ShopifyOrderLine"("orderId", "shopifyLineId");
