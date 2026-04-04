# Session 4a: Sales Data Architecture — Design Document

**Date:** 2026-04-01
**Status:** Draft — for review before implementation
**Scope:** Research findings + design for sales data ingestion pipeline

---

## Part 1: Current State Findings

### 1.1 Shopify API Configuration

**Scopes requested:** `read_products,write_products,read_orders,read_customers`
(defined in `server/src/services/shopify.js:27`).

- `read_orders` is included — we can pull order data.
- `read_inventory` is NOT requested (and is OUT OF SCOPE per design rules).
- `read_customers` is requested, providing customer name/email on orders.

**Scope discrepancy:** `server/src/routes/connect.js:36-43` lists `read_inventory`
instead of `read_customers` for both `shopify` and `shopify-pos` entries.
This is a mock/wizard file and doesn't affect the real OAuth flow, but should
be corrected for consistency.

**API version:** `2026-01` (env var `SHOPIFY_API_VERSION`, default in `shopify.js:26`).

### 1.2 Shopify Order Data: What We Capture vs What's Available

| Field | Shopify Provides | Captured Today | Gap |
|---|---|---|---|
| Order ID, order number | `id`, `order_number`, `name` | Yes (`shopifyOrderId`, `shopifyOrderName`) | — |
| Order date | `created_at` | Yes (`orderDate`) | — |
| Customer name/email | `customer.first_name`, etc. | Yes | — |
| Total price | `total_price` | Yes (`totalPrice`) | — |
| **Subtotal** | `subtotal_price` | Schema exists (`subtotalPrice`) but **NOT populated by syncOrders()** | Bug |
| **Total tax** | `total_tax` | Schema exists (`totalTax`) but **NOT populated by syncOrders()** | Bug |
| **Total discount** | `total_discounts` | No schema field, not captured | Missing |
| Financial status | `financial_status` | Yes | — |
| Fulfillment status | `fulfillment_status` | Yes | — |
| Currency | `currency` | Yes | — |
| **`source_name`** | `source_name` (web, pos, shopify_draft_order) | **Not captured** | Critical for channel analysis |
| **Line discount** | `line_item.total_discount` | Not captured | Missing |
| **Line total** | `line_item.price * qty - discount` | Schema exists (`totalPrice`) but **NOT populated** | Bug |
| Line SKU, titles, qty, unit price | Various `line_item.*` fields | Yes | — |
| Line variant/product IDs | `variant_id`, `product_id` | `variant_id` used for matching | — |
| **Refund data** | `refunds[]` array | **Not captured** | RISK-014 |
| **Tax lines** | `tax_lines[]` per line item | Not captured | Missing (not critical for MVP) |

### 1.3 syncOrders() Function Assessment

**Location:** `server/src/services/shopify.js:741-877`

**How it's triggered:** Manual button press via `POST /api/shopify/sync-orders`
(UI: IntegrationsTab.jsx:501). No webhooks, no cron job.

**What works:**
- Incremental sync using `created_at_min` from `lastOrderSyncAt`
- Upserts ShopifyOrder by `[integrationId, shopifyOrderId]`
- Upserts ShopifyOrderLine by `[orderId, shopifyLineId]`
- Links line items to ProductVariant via shopifyVariantId (preferred) or SKU (fallback)
- Paginates with cursor-based `Link` header parsing (max 20 pages = 5000 orders)

**Known bugs (confirmed in tests file shopify-adapter-integration.test.js:399-418):**
1. `orderedAt` used in routes/shopify.js:123 but schema field is `orderDate` — **runtime crash**
2. `subtotalPrice` never set (schema default 0, should use `order.subtotal_price`)
3. `totalTax` never set (schema default 0, should use `order.total_tax`)
4. `totalPrice` on ShopifyOrderLine never set (should be `qty * price - discount`)
5. `source_name` not captured at all

**Known limitation (RISK-014):** Incremental sync uses `created_at_min`. Orders
modified after creation (refunds, fulfillment changes, partial returns) are not
re-fetched. Revenue figures may be overstated.

### 1.4 Existing Schema: ShopifyOrder + ShopifyOrderLine

**ShopifyOrder** (schema.prisma:639-663):
```
id, tenantId, shopifyOrderId, shopifyOrderName, integrationId,
orderDate, customerName, customerEmail, financialStatus,
fulfillmentStatus, totalPrice, subtotalPrice, totalTax,
currency, createdAt, updatedAt

@@unique([integrationId, shopifyOrderId])
```

**ShopifyOrderLine** (schema.prisma:665-684):
```
id, orderId, shopifyLineId, productVariantId (FK → ProductVariant, nullable),
sku, productTitle, variantTitle, quantity, unitPrice, totalPrice,
createdAt

@@unique([orderId, shopifyLineId])
```

**Key relationship:** ShopifyOrderLine.productVariantId → ProductVariant → Product.
This chain exists and works when the variant can be matched at sync time.

### 1.5 Invoice Schema (Purchase Costs — Not Sales)

**Invoices represent PURCHASE costs from suppliers**, not sales to customers.
They are the cost side of the margin equation:

- Invoice → InvoiceLine → InvoiceLineMatch → ProductVariant.currentCost
- Fields: supplierId, supplierName, freight, GST, OCR confidence
- Purpose: landed cost calculation, cost tracking, supplier management

### 1.6 Product Catalog and Cost Price Storage

**Cost price stored at multiple levels:**

| Location | Field | Purpose |
|---|---|---|
| Product | `costPrice` (Float?) | Product-level cost (summary) |
| Product | `sellingPrice` (Float?) | Product-level selling price |
| ProductVariant | `currentCost` (Float) | Current cost per variant (updated by invoice processing) |
| ProductVariant | `salePrice` (Float) | Current selling price per variant |
| InvoiceLineMatch | `previousCost`, `newCost` | Point-in-time cost tracking from invoices |

**Cost flow:** Invoice OCR → InvoiceLine → InvoiceLineMatch → ProductVariant.currentCost

**Cross-source linking:** Product has `canonicalProductId` (self-referential FK).
When the same real-world product exists from multiple sources (Shopify, CSV, invoice),
they share a canonical ID. CatalogMatcher (`server/src/services/agents/pipeline/stages/catalogMatcher.js`)
handles this with 3-layer matching:
- Layer 1: Exact identity (fingerprint, externalId+sourceSystem, barcode, SKU)
- Layer 2: Fuzzy semantic (Fuse.js name similarity, category, baseUnit)
- Layer 3: Vector similarity (embeddings via vectorStore)

### 1.7 Shopify POS vs Online Orders

Shopify POS and online orders use the **same Orders API**. They are
distinguished by the `source_name` field:
- `web` — online storefront
- `pos` — Shopify POS in-store
- `shopify_draft_order` — manual/draft orders
- `iphone`, `android` — mobile app orders

Currently **not captured** — this must be added to enable channel analysis.

### 1.8 Summary of Critical Gaps

| # | Gap | Impact | Fix Complexity |
|---|---|---|---|
| 1 | `subtotalPrice`, `totalTax`, line `totalPrice` not populated | Incorrect tax/subtotal data | Small (add fields to syncOrders) |
| 2 | `source_name` not captured | Can't distinguish web vs POS vs draft | Small (add field + capture) |
| 3 | `orderedAt` vs `orderDate` field name bug | Orders list endpoint crashes | Trivial rename |
| 4 | No discount capture (order or line level) | Can't analyze discount impact | Small |
| 5 | No refund/return handling | Revenue overstated for refunded orders | Medium |
| 6 | No cost-at-time-of-sale snapshot | Historical margins inaccurate | Medium (depends on PriceChangeLog) |
| 7 | No automated sync trigger | Data only updates on manual click | Medium (cron or webhook) |
| 8 | No POS CSV import path | Can't ingest non-Shopify sales | Large (new pipeline) |
| 9 | No sales analysis layer | Data stored but never queried for insights | Large (RISK-021) |

---

## Part 2: Recommended Data Model

### 2.1 Architecture Decision: Option B — Canonical SalesTransaction + SalesLineItem

**Decision:** Create new source-agnostic `SalesTransaction` + `SalesLineItem` tables.
ShopifyOrder feeds into SalesTransaction, just as ShopifyProduct feeds into Product.

**Rationale:**
- Follows the established pattern: source-specific records → canonical records
- Product architecture already uses `canonicalProductId` for cross-source linking
- The product import pipeline (SourceResolver → CatalogMatcher → WriteLayer) proves this pattern works
- POS CSV data, Square data, Lightspeed data can all feed into the same canonical tables
- Analysis queries hit one table regardless of source (no UNION across different structures)
- ShopifyOrder/ShopifyOrderLine remain as source records (not deleted, not renamed)

**Trade-off acknowledged:** More tables and a sync layer from ShopifyOrder → SalesTransaction.
This is the same trade-off accepted for products, and it paid off there.

### 2.2 Data Flow

```
Source Layer (raw)          Canonical Layer (analysis)       Cost Layer
─────────────────          ──────────────────────────       ──────────
ShopifyOrder ──────┐
                   ├──→ SalesTransaction ──→ SalesLineItem ──→ PriceChangeLog lookup
POS CSV Upload ────┘           │                    │              ↓
                               │                    ├──→ productId → Product
                               │                    └──→ variantId → ProductVariant
                               │
                          source = "shopify" | "pos_csv" | "manual" | ...
```

### 2.3 Schema Design: SalesTransaction

```prisma
model SalesTransaction {
  id                String    @id @default(cuid())
  tenantId          String
  source            String                            // "shopify", "pos_csv", "square", "manual"
  sourceId          String?                           // external ID from source system (e.g. Shopify order ID)
  sourceChannel     String?                           // "web", "pos", "draft_order" — from source system
  transactionDate   DateTime                          // when the sale occurred
  subtotal          Float     @default(0)             // sum of line totals before tax
  totalDiscount     Float     @default(0)             // order-level discount total
  totalTax          Float     @default(0)
  totalAmount       Float     @default(0)             // final amount charged
  currency          String    @default("AUD")
  status            String    @default("completed")   // completed, refunded, partially_refunded, cancelled
  customerName      String?
  customerEmail     String?
  metadata          Json?                             // source-specific data (Shopify order JSON, etc.)

  // Import tracking
  importJobId       String?                           // FK → ImportJob (for CSV imports)
  sourceRecordId    String?                           // FK-like pointer to source record (ShopifyOrder.id)

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  tenant            Tenant    @relation(fields: [tenantId], references: [id])
  lines             SalesLineItem[]

  @@unique([tenantId, source, sourceId])              // prevents duplicate imports
  @@index([tenantId])
  @@index([tenantId, transactionDate])
  @@index([tenantId, source])
  @@index([status])
}
```

**Design notes:**
- `source` is a free string, not an enum — avoids migrations when adding new integrations
- `sourceChannel` captures sub-channel (web vs POS) separately from source system
- `sourceId` is the external system's ID (Shopify order ID, POS receipt number)
- `@@unique([tenantId, source, sourceId])` prevents the same order from being imported twice
- `metadata` stores source-specific data we don't want to lose but don't need columns for
- `importJobId` links to ImportJob for CSV imports (reuses existing job tracking)
- `sourceRecordId` is an informal pointer back to the source record (e.g., ShopifyOrder.id)
  for traceability — not a formal FK because source tables vary

### 2.4 Schema Design: SalesLineItem

```prisma
model SalesLineItem {
  id                String    @id @default(cuid())
  transactionId     String                            // FK → SalesTransaction
  tenantId          String
  productId         String?                           // FK → Product (nullable until matched)
  variantId         String?                           // FK → ProductVariant (nullable until matched)
  sourceProductId   String?                           // external product ID from source system
  sourceVariantId   String?                           // external variant ID from source system
  productName       String                            // product name captured at time of sale
  variantName       String?                           // variant name captured at time of sale
  sku               String?
  barcode           String?
  quantity          Int       @default(1)
  unitPrice         Float     @default(0)             // selling price per unit at time of sale
  discount          Float     @default(0)             // discount applied to this line
  lineTotal         Float     @default(0)             // (unitPrice * quantity) - discount

  // Cost and margin (populated from PriceChangeLog lookup)
  costPriceAtSale   Float?                            // null if no cost data for this sale date
  marginAmount      Float?                            // unitPrice - costPriceAtSale (null if cost unknown)
  marginPercent     Float?                            // marginAmount / unitPrice * 100 (null if cost unknown)
  costDataAvailable Boolean   @default(false)         // quick filter for margin analysis queries

  // Product matching
  matchStatus       String    @default("unmatched")   // matched, unmatched, review
  matchConfidence   Float?                            // 0.0-1.0 confidence score
  matchMethod       String?                           // "shopify_variant_id", "sku", "barcode", "fuzzy_name"

  metadata          Json?                             // source-specific line data

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  transaction       SalesTransaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  tenant            Tenant           @relation(fields: [tenantId], references: [id])
  product           Product?         @relation(fields: [productId], references: [id])
  variant           ProductVariant?  @relation(fields: [variantId], references: [id])

  @@unique([transactionId, sourceVariantId])          // prevents duplicate line items per transaction
  @@index([tenantId])
  @@index([transactionId])
  @@index([productId])
  @@index([variantId])
  @@index([tenantId, matchStatus])
  @@index([tenantId, costDataAvailable])
}
```

**Design notes:**
- `productName` and `variantName` are captured at time of sale — the product
  may be renamed or archived later, but the sale record preserves what was sold
- `unitPrice` is the selling price at time of sale — not the current price
- `costPriceAtSale` is populated by PriceChangeLog lookup (Session 5 dependency)
- `costDataAvailable` boolean avoids `IS NOT NULL` checks in every analysis query
- `matchStatus` tracks whether the line item has been linked to the product catalog
- `@@unique([transactionId, sourceVariantId])` prevents duplicate lines within a transaction
  (for Shopify, sourceVariantId = shopifyLineId)

### 2.5 Required Schema Additions to Existing Models

**Tenant model** — add relations:
```prisma
  salesTransactions    SalesTransaction[]
  salesLineItems       SalesLineItem[]
```

**Product model** — add relation:
```prisma
  salesLineItems       SalesLineItem[]
```

**ProductVariant model** — add relation:
```prisma
  salesLineItems       SalesLineItem[]
```

**SourceType enum** — add value:
```prisma
  POS_CSV_UPLOAD    // for POS/till CSV sales imports
```

### 2.6 Key Design Decisions

#### D1: Point-in-time pricing — YES

`unitPrice` captures selling price at time of sale (from the source system).
`costPriceAtSale` captures cost price at time of sale (from PriceChangeLog lookup).
Both are immutable once written. Analysis always uses these snapshot values,
never current prices.

#### D2: Product matching strategy

**For Shopify orders:**
1. Match via `shopifyVariantId` → ProductVariant.shopifyVariantId (highest confidence)
2. Fallback: match via SKU → ProductVariant.sku (high confidence)
3. Fallback: match via product name fuzzy match (medium confidence, routes to review)

This is the same matching that `syncOrders()` already does at lines 770-839.
The sales pipeline formalizes it with confidence scores and review routing.

**For POS CSV imports:**
1. Match via SKU → ProductVariant.sku (high confidence)
2. Match via barcode → Product.barcode or ProductVariant barcode (high confidence)
3. Fallback: match via product name using CatalogMatcher Layer 2 (fuzzy match)
4. Fallback: match via CatalogMatcher Layer 3 (embedding similarity)
5. Unmatched items → `matchStatus = 'review'` for human resolution

**Confidence thresholds:**
- >= 0.95: Auto-match (`matchStatus = 'matched'`)
- 0.70 - 0.94: Route to review (`matchStatus = 'review'`)
- < 0.70: Unmatched (`matchStatus = 'unmatched'`)

#### D3: Deduplication

**Same order from multiple sources:**
The `@@unique([tenantId, source, sourceId])` constraint prevents the same order
from the same source being imported twice. If the same physical sale appears
from both Shopify and a POS CSV (unlikely but possible), they get separate
SalesTransaction records with different `source` values. This is correct —
the analysis layer should NOT double-count. Resolution:
- For Shopify+POS overlap: if a retailer uses Shopify POS, their POS sales
  come through the Shopify Orders API with `source_name = 'pos'`. They should
  NOT also import a POS CSV for the same period. The UI should warn about this.
- If double-import happens: admin can mark transactions as `status = 'cancelled'`
  to exclude from analysis.

**Refunded orders:**
- `SalesTransaction.status` = `'refunded'` or `'partially_refunded'`
- For Shopify: captured from `financial_status` on the order
- For partial refunds: the transaction keeps its original line items; a separate
  refund transaction is NOT created at MVP. The `status` flag is sufficient for
  analysis queries to filter/flag refunded orders.
- Post-MVP enhancement: separate RefundTransaction with negative quantities
  for precise partial refund tracking.

#### D4: Currency

AUD only at launch. The `currency` field (String, default "AUD") is included
on SalesTransaction so adding multi-currency later requires no schema migration —
only logic changes in the analysis layer. No currency conversion needed at MVP.

#### D5: Historical import / backfill

When a customer first connects Shopify:
- `syncOrders()` fetches all orders (no `sinceDate` on first sync) up to
  5000 orders (20 pages x 250).
- These flow into SalesTransaction with `costPriceAtSale = null` for any
  period before cost data exists in PriceChangeLog.
- This is expected and handled by the cost data gap rules (see section 2.7).

For POS CSV: the retailer uploads historical CSV exports. The import pipeline
processes them identically to current data. Old sales without cost data get
`costPriceAtSale = null`.

#### D6: POS CSV format flexibility

Different POS systems export different CSV formats. The sales CSV import will
use a **column mapper** (similar to the product CSV import):
- User uploads CSV
- System detects or asks user to map columns: Date, Receipt#, Item Name, SKU,
  Qty, Unit Price, Discount, Total
- Mapped data flows through the sales pipeline

This reuses the `columnMapping` infrastructure already in ImportJob.

### 2.7 Cost-at-Time-of-Sale Rules

#### Source of cost data

Cost data does NOT come from source sales systems. None of them provide
cost-of-goods in their order data.

Cost data comes exclusively from RetailEdgeAI's own invoice processing pipeline:
**Invoice OCR → InvoiceLine → InvoiceLineMatch → ProductVariant.currentCost**

#### Costing methodology: Latest Invoice Cost Applies Forward

When an invoice is processed and a product's cost is updated, that cost applies
to all subsequent sales until the next invoice changes it.

```
Invoice #1001 (15 March) → Widget cost = $5.00
  Sales 16-31 March → cost = $5.00 each
Invoice #1002 (1 April) → Widget cost = $5.50
  Sales 1+ April → cost = $5.50 each
```

Cost lookup uses **PriceChangeLog** (Session 5):
```sql
SELECT newPrice FROM PriceChangeLog
WHERE productId = :productId
  AND priceType = 'cost_price'
  AND createdAt <= :saleDatetime
ORDER BY createdAt DESC
LIMIT 1
```

#### Cost data priority hierarchy

1. **Invoice-matched cost (highest priority):** From supplier invoice processing.
   PriceChangeLog entry with `changeSource = 'invoice_processing'`.

2. **Product catalog import cost (fallback):** From CSV import, Shopify sync,
   or manual entry. Less accurate but better than nothing. PriceChangeLog entry
   with `changeSource = 'bulk_import'` or `'shopify_sync'`.

PriceChangeLog handles priority naturally via timestamps — the most recent
`cost_price` entry before the sale date wins, regardless of source.

#### SalesLineItem.costPriceAtSale population

For each SalesLineItem during ingestion:
1. If `productId` is not null (matched to catalog):
   - Query PriceChangeLog for most recent `cost_price` before transaction date
   - If found: set `costPriceAtSale`, `marginAmount`, `marginPercent`, `costDataAvailable = true`
   - If not found: set all to null, `costDataAvailable = false`
2. If `productId` is null (unmatched):
   - `costPriceAtSale = null`, `costDataAvailable = false`

#### Historical data gap handling

The system MUST NOT:
- Assume cost is zero (would show misleading 100% margins)
- Guess or extrapolate costs
- Hide sales without cost data

The system MUST:
- Store sales with `costPriceAtSale = null`
- Calculate margin as null (not zero) when cost is unknown
- In analysis, separate "sales with known margins" from "sales without cost data"
- Report the date from which cost data is available per product

#### Impact on Session 5 (PriceChangeLog)

Session 5 MUST ensure cost prices are logged to PriceChangeLog when products are
imported with cost data:
- CSV/bulk import: `changeSource = 'bulk_import'`
- Shopify product sync: `changeSource = 'shopify_sync'`
- Manual product creation: `changeSource = 'manual_edit'`

Without this, the cost priority hierarchy breaks — catalog import costs won't
appear in PriceChangeLog and cost-at-time-of-sale lookups will return null even
when a cost was provided during import.

---

## Part 3: Pipeline Architecture

### 3.1 Sales Pipeline Design

The sales pipeline is simpler than the product pipeline. Products require
dedup, normalisation, and human approval because product identity is ambiguous.
Sales are factual records — a sale either happened or it didn't.

The main complexity is **product matching**: linking each sold item to the
product catalog so we can associate cost data.

#### Pipeline Stages

```
Stage 1: Source Adapter        → Extract & normalize from source format
Stage 2: Dedup Check           → Reject already-imported transactions
Stage 3: Product Matcher       → Link line items to Product/ProductVariant
Stage 4: Cost Enrichment       → Look up costPriceAtSale from PriceChangeLog
Stage 5: Write Layer           → Persist SalesTransaction + SalesLineItem
Stage 6: Post-Write Hooks      → Update integration metadata, emit signals
```

**Comparison to product pipeline (9 stages):**

| Product Pipeline Stage | Sales Equivalent | Reused? |
|---|---|---|
| SourceResolver | Source Adapter | Pattern reused, new implementation |
| NormalisationEngine | (in Source Adapter) | N/A — sales fields are simpler |
| FingerprintEngine | (not needed) | N/A — sales don't need dedup fingerprints |
| CatalogMatcher | Product Matcher | **Reusable** — Layer 1 exact match logic |
| InvoiceRiskAnalyser | (not needed) | N/A — no risk analysis for sales |
| ConfidenceScorer | (in Product Matcher) | Scoring logic reusable |
| ApprovalClassifier | (in Product Matcher) | Threshold logic reusable |
| WriteLayer | Write Layer | Pattern reused, new implementation |
| AuditLogger | Post-Write Hooks | Pattern reused |

### 3.2 Stage Details

#### Stage 1: Source Adapter

**Purpose:** Convert source-specific data into a canonical `SalesTransactionInput` shape.

**Implementations needed:**
- `ShopifySalesAdapter` — converts ShopifyOrder → SalesTransactionInput
- `CsvSalesAdapter` — converts mapped CSV rows → SalesTransactionInput

**SalesTransactionInput shape (internal, not persisted):**
```javascript
{
  source: 'shopify',
  sourceId: '5678901234',
  sourceChannel: 'web',
  transactionDate: '2026-03-15T10:30:00Z',
  subtotal: 45.00,
  totalDiscount: 5.00,
  totalTax: 4.00,
  totalAmount: 44.00,
  currency: 'AUD',
  status: 'completed',
  customerName: 'Jane Smith',
  customerEmail: 'jane@example.com',
  metadata: { /* raw source data */ },
  lines: [
    {
      sourceProductId: '12345',
      sourceVariantId: '67890',
      productName: 'Organic Coffee Beans',
      variantName: '1kg bag',
      sku: 'COF-ORG-1KG',
      barcode: '9312345678901',
      quantity: 2,
      unitPrice: 25.00,
      discount: 5.00,
      lineTotal: 45.00,
    }
  ]
}
```

**ShopifySalesAdapter specifics:**
- Can work in two modes:
  1. **Direct API mode:** during `syncOrders()`, converts raw Shopify API response
  2. **Source record mode:** converts existing ShopifyOrder/ShopifyOrderLine records
     (for backfilling existing data into SalesTransaction)
- Maps `order.source_name` → `sourceChannel`
- Maps `order.financial_status` → `status` (paid→completed, refunded→refunded, etc.)

**CsvSalesAdapter specifics:**
- Accepts a column mapping (from ImportJob.columnMapping)
- Required columns: Date, Item Name, Quantity, Unit Price
- Optional columns: Receipt#, SKU, Barcode, Discount, Total, Customer
- Groups rows by receipt number (if present) into SalesTransactions
- If no receipt number: each row becomes its own single-line transaction

#### Stage 2: Dedup Check

**Purpose:** Skip transactions that already exist in the database.

**Logic:**
- Query `SalesTransaction` by `[tenantId, source, sourceId]`
- If exists and source data hasn't changed: skip (increment `rowsSkipped`)
- If exists and source data changed (e.g., status update): update in place
- If not exists: proceed to next stage

For CSV imports without a receipt number (sourceId = generated hash):
- Generate a dedup key from `date + item + qty + price`
- This prevents re-importing the same CSV file

#### Stage 3: Product Matcher

**Purpose:** Link each SalesLineItem to a Product/ProductVariant.

**Matching strategy (ordered by confidence):**

For Shopify:
1. `sourceVariantId` → ProductVariant.shopifyVariantId (confidence: 1.0)
2. `sourceProductId` → Product.externalId where source='shopify' (confidence: 0.95)
3. SKU exact match → ProductVariant.sku (confidence: 0.90)
4. Barcode exact match → Product.barcode (confidence: 0.95)
5. Name fuzzy match via CatalogMatcher Layer 2 (confidence: 0.70-0.89)

For POS CSV:
1. SKU exact match → ProductVariant.sku (confidence: 0.95)
2. Barcode exact match → Product.barcode (confidence: 0.95)
3. Name fuzzy match via CatalogMatcher Layer 2 (confidence: 0.70-0.89)
4. Name embedding match via CatalogMatcher Layer 3 (confidence: variable)

**Reusable from CatalogMatcher:**
- `layer1Match()` — exact identity matching (fingerprint, externalId, barcode, SKU)
- `layer2Match()` — Fuse.js fuzzy matching
- Vector similarity via `findNearestProducts()`

The Product Matcher wraps these with sales-specific logic (the CatalogMatcher
works on CanonicalProduct objects; we need a thin adapter to present
SalesLineItems in a compatible format).

**Match routing:**
- Confidence >= 0.95: auto-match, set `matchStatus = 'matched'`
- Confidence 0.70 - 0.94: set `matchStatus = 'review'` for human confirmation
- Confidence < 0.70 or no match: set `matchStatus = 'unmatched'`

#### Stage 4: Cost Enrichment

**Purpose:** Look up `costPriceAtSale` from PriceChangeLog for matched items.

**Dependency:** PriceChangeLog (Session 5). If PriceChangeLog doesn't exist
yet when this pipeline ships, this stage is a no-op that sets all cost fields
to null. It can be backfilled later.

**Logic per line item:**
```javascript
if (lineItem.productId) {
  const costEntry = await prisma.priceChangeLog.findFirst({
    where: {
      productId: lineItem.productId,
      priceType: 'cost_price',
      createdAt: { lte: transaction.transactionDate },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (costEntry) {
    lineItem.costPriceAtSale = costEntry.newPrice;
    lineItem.marginAmount = lineItem.unitPrice - costEntry.newPrice;
    lineItem.marginPercent = lineItem.unitPrice > 0
      ? (lineItem.marginAmount / lineItem.unitPrice) * 100
      : null;
    lineItem.costDataAvailable = true;
  }
}
```

**Performance consideration:** For bulk imports with thousands of line items,
batch the PriceChangeLog lookups rather than one query per line. Group by
productId, find the relevant cost entry per product for the transaction date range.

#### Stage 5: Write Layer

**Purpose:** Persist SalesTransaction + SalesLineItems to the database.

**Implementation:**
- Use `prisma.$transaction()` — each SalesTransaction and its lines are
  written atomically
- Upsert by `[tenantId, source, sourceId]` for idempotency
- Update ImportJob progress counters (rowsCreated, rowsUpdated, etc.)

#### Stage 6: Post-Write Hooks

**Purpose:** Side effects after successful write.

**Actions:**
- Update ShopifyIntegration.orderCount (for Shopify source)
- Create ShopifyImportLog entry (for Shopify source)
- Emit agent signals for the import pipeline agent registry
- Log audit entry

### 3.3 Reusable Components Summary

| Component | Reuse Type | Notes |
|---|---|---|
| PipelineRunner | Direct reuse | Orchestrates stages in order — works for any pipeline |
| PipelineStage base class | Direct reuse | Stages extend this |
| PipelineContext | Extend | Add sales-specific counters (transactionsCreated, linesMatched, etc.) |
| CatalogMatcher Layer 1 | Extract & reuse | Exact match logic (SKU, barcode, externalId) |
| CatalogMatcher Layer 2 | Extract & reuse | Fuse.js fuzzy matching |
| Vector similarity | Direct reuse | `findNearestProducts()` from vectorStore |
| ImportJob model | Direct reuse | Track CSV import jobs with existing infrastructure |
| ImportJob service | Extend | Add `createSalesImportJob()` alongside existing `createImportJob()` |
| Column mapping UI | Pattern reuse | Same UX pattern, new column set |
| Source adapter pattern | Pattern reuse | Same interface, new implementations |
| Agent registry | Direct reuse | Register `sales_import_pipeline` agent |

### 3.4 CSV Import Design

**UI flow:**
1. User navigates to Sales → Import Sales Data
2. Uploads CSV file
3. System detects format (if recognizable POS format) or shows column mapper
4. User maps columns: Date, Receipt#, Item, SKU, Qty, Unit Price, Discount, Total
5. Preview: first 10 rows shown in mapped format
6. User confirms → ImportJob created → pipeline runs
7. Progress shown in real-time (same pattern as product import)
8. Results: X transactions created, Y line items matched, Z needing review

**Column mapper reuses** the existing `ImportJob.columnMapping` JSON field.

**Known POS formats to auto-detect (future enhancement):**
- Square CSV export
- Lightspeed CSV export
- Hike POS export
- Generic receipt format (Date, Item, Qty, Price, Total)

At MVP: manual column mapping only. Auto-detection is post-launch polish.

### 3.5 Shopify Sales Sync Flow

**Flow for `syncOrders()` integration:**

```
1. syncOrders() fetches orders from Shopify API (existing code)
2. Each order → ShopifySalesAdapter.transform() → SalesTransactionInput
3. SalesTransactionInput → Dedup Check → Product Matcher → Cost Enrichment → Write
4. ShopifyOrder/ShopifyOrderLine still written (existing code, bugs fixed)
5. SalesTransaction/SalesLineItem written as canonical records
```

**Option A (recommended for MVP):** Write SalesTransaction directly in
`syncOrders()` alongside ShopifyOrder. This avoids a separate sync-from-source-
to-canonical step and means canonical records are created in real-time.

**Option B (cleaner but more work):** Keep `syncOrders()` writing only to
ShopifyOrder, then run a separate job that reads ShopifyOrder and writes
SalesTransaction. This is the "pure" pattern but adds complexity and latency.

**Recommendation:** Option A for MVP. The ShopifySalesAdapter transforms each
Shopify order into a SalesTransactionInput, and the write layer creates both
ShopifyOrder (source record) and SalesTransaction (canonical record) in the
same sync operation.

### 3.6 Backfill Strategy

For tenants who already have ShopifyOrder data:
- One-time migration script reads all existing ShopifyOrders
- Transforms each through ShopifySalesAdapter
- Runs Product Matcher + Cost Enrichment + Write for each
- Creates SalesTransaction records for historical data

This can be a CLI command or admin endpoint, not user-facing.

---

## Part 4: Effort Estimate and Recommendations

### 4.1 Effort Estimate

| Work Package | Sessions | Dependencies |
|---|---|---|
| **Fix syncOrders() bugs** (subtotal, tax, discount, source_name, orderedAt) | 0.5 | None |
| **Schema migration** (SalesTransaction + SalesLineItem + relations) | 0.5 | None |
| **ShopifySalesAdapter** + integration with syncOrders() | 1 | Schema migration |
| **Product Matcher** (extract from CatalogMatcher, adapt for sales) | 1 | Schema migration |
| **Cost Enrichment stage** | 0.5 | Session 5 (PriceChangeLog) |
| **Write Layer + Post-Write Hooks** for sales | 0.5 | Schema migration |
| **Backfill script** for existing ShopifyOrder data | 0.5 | All above |
| **POS CSV import** (adapter, column mapper, UI) | 1.5-2 | Schema migration, Product Matcher |
| **Sales analysis tools** for Business Advisor (RISK-021) | 1-1.5 | SalesTransaction data |
| **Tests** (unit + integration for all above) | 1 | All above |
| **Total** | **~8-9 sessions** | |

### 4.2 MVP Recommendation

**MVP (launch-ready in ~4 sessions):**
1. Fix syncOrders() bugs (0.5 sessions)
2. Schema migration for SalesTransaction + SalesLineItem (0.5 sessions)
3. ShopifySalesAdapter + Product Matcher + Write Layer (2 sessions)
4. Basic sales analysis tools for Business Advisor (1 session)

**MVP delivers:**
- Shopify order data flows into canonical SalesTransaction tables
- Line items matched to product catalog with confidence scoring
- Cost enrichment ready to activate when PriceChangeLog ships (Session 5)
- Business Advisor can answer "what are my top sellers?" and "revenue this month?"

**Deferred to post-launch:**
- POS CSV import (1.5-2 sessions)
- Refund transaction handling (0.5 sessions)
- Automated sync via cron or webhook (0.5 sessions)
- Advanced channel analysis (web vs POS breakdown)

### 4.3 Launch Risk Assessment

**Can RetailEdgeAI launch without sales analysis?**

No — it's a stated beta requirement (RISK-021):
> "Sales data ingestion from e-commerce platform (order history, sales volumes,
> revenue by product)" and "basic demand forecasting from historical sales data."

**Impact on value proposition:**
- Without sales data: the platform is an invoice processor + pricing tool
- With sales data: the platform becomes a margin analysis + business intelligence tool
- The Business Advisor without sales tools can't answer the most basic business
  question: "How are my products selling?"

**Recommendation:** Ship the MVP (Shopify orders → SalesTransaction → basic
analysis tools) at launch. POS CSV import can follow in the first post-launch sprint.

### 4.4 Dependency Map

| Session | Depends On | Affected By This Design |
|---|---|---|
| **Session 4a** (this) | None | — |
| **Session 5** (PriceChangeLog) | None | MUST log cost prices during product import. Cost Enrichment stage depends on PriceChangeLog existing. |
| **Session 6** (Business Advisor tools) | SalesTransaction schema | New advisor tools query SalesTransaction + SalesLineItem. Must handle `costDataAvailable` flag. |
| **Session 7** (if it covers refunds) | SalesTransaction schema | Refund handling design builds on `status` field. |
| **Session 8** (if it covers analytics dashboard) | Sales analysis tools | Dashboard visualizations consume the same data as advisor tools. |

**Critical path:** Session 5 (PriceChangeLog) should be completed before or
in parallel with the sales pipeline build. Without it, `costPriceAtSale` is
always null, and margin analysis is impossible. Revenue analysis works regardless.

### 4.5 Build Order Recommendation

```
Session 4b: Fix syncOrders() bugs + SalesTransaction schema migration
Session 5:  PriceChangeLog (already planned — ensure cost import logging)
Session 4c: ShopifySalesAdapter + Product Matcher + Write Layer + Backfill
Session 4d: Cost Enrichment (depends on Session 5) + Tests
Session 6:  Business Advisor sales analysis tools (depends on 4c data)
```

Sessions 4b and 5 can run in parallel if worked by different developers
(or sequentially if single-developer). Session 4c depends on 4b's schema.
Session 4d depends on Session 5's PriceChangeLog.

---

## Appendix A: Fields NOT Included (and Why)

| Field | Reason for Exclusion |
|---|---|
| `read_inventory` scope / Shopify cost data | Out of scope per design rules. Cost comes from invoices only. |
| FIFO inventory costing | Year 2 feature. Latest-cost-applies-forward is sufficient for launch. |
| Multi-currency conversion | AUD only at launch. Schema supports it; logic deferred. |
| RefundTransaction model | MVP uses status flag. Separate refund records are post-launch. |
| Webhook-based real-time sync | MVP uses manual sync + future cron. Webhooks are post-launch. |
| Per-line tax breakdown | Not needed for MVP margin analysis. Can be added to metadata JSON. |

## Appendix B: Strategic Advisor Cost Data Gap Prompt

Add to the Business Advisor's system prompt or context instructions:

```
When analysing margins:
- If a product has no cost data for a period, say so explicitly:
  "Cost data for [Product] is only available from [date] onwards.
  Sales before this date are included in revenue figures but excluded
  from margin calculations."
- When cost data comes from a catalog import rather than a matched invoice,
  note the lower confidence: "Margins for [Product] are based on the cost
  price provided during product import ($X.XX). Processing a supplier
  invoice for this product would give a more accurate cost."
- Never present margin analysis as complete if cost data is missing
  for a significant portion of the sales period.
- If the user asks "what are my margins?" and less than 50% of products
  have cost data, lead with: "I can only calculate margins for [X] of
  your [Y] products because cost data hasn't been imported for the rest.
  To improve this, process your supplier invoices through the invoice
  import feature."
- This turns a data gap into a feature adoption nudge.
```
