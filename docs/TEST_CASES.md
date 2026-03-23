# RetailEdge — Test Cases & Test Plan

## 1. Test Infrastructure

| Component | Technology | Config |
|---|---|---|
| Test runner | vitest | `server/vitest.config.js` |
| HTTP testing | supertest | Integrated with Express app |
| Test database | PostgreSQL 16 | `retailedge_test` (Docker) |
| Global setup | `tests/setup.js` | Runs migrations + grants permissions |
| Fixtures | `tests/helpers/fixtures.js` | Factory functions for test data |
| Cleanup | `tests/helpers/prisma.js` | `cleanDatabase()` truncates all tables |

### Test Execution
```bash
# Run all tests (273 tests, 12 files)
cd server && npx vitest run

# Run specific test file
npx vitest run tests/folder-integration.test.js

# Run with coverage
npx vitest run --coverage
```

### Test Database Setup
- Global setup (`tests/setup.js`) runs `prisma migrate deploy` against test DB
- Grants `retailedge_app` role access to all tables (tables created by superuser)
- `fileParallelism: false` — test files run sequentially (shared database)
- Each test file calls `cleanDatabase()` in `beforeAll` and `afterAll`

---

## 2. Test Suite Summary

| Test File | Tests | Coverage Area |
|---|---|---|
| `tenant-isolation.test.js` | 13 | Multi-tenant data isolation |
| `plan-gating.test.js` | 18 | Feature gating by subscription plan |
| `feature-gating-e2e.test.js` | 23 | End-to-end plan upgrade/downgrade |
| `api-integration.test.js` | 24 | Core API CRUD operations |
| `admin-api.test.js` | 23 | Admin portal endpoints |
| `matching-engine.test.js` | 32 | Product matching strategies |
| `pricing-service.test.js` | 31 | Pricing calculation engine |
| `gmail-integration.test.js` | 31 | Gmail OAuth + polling + dedup |
| `folder-integration.test.js` | 36 | Folder polling + validation + dedup |
| `signal-collector.test.js` | 15 | Signal capture + buffer flush |
| `suggestion-engine.test.js` | 16 | Suggestion engine pipeline |
| `meta-optimizer.test.js` | 11 | Cross-tenant meta-optimization |
| **Total** | **273** | |

---

## 3. Test Cases by Category

### 3.1 Tenant Isolation (13 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| TI-01 | Tenant A cannot read Tenant B's invoices | GET returns only own invoices |
| TI-02 | Tenant A cannot read Tenant B's products | GET returns only own products |
| TI-03 | Tenant A cannot update Tenant B's invoice | 404 or empty result |
| TI-04 | Tenant A cannot delete Tenant B's product | 404 or empty result |
| TI-05 | Tenant A cannot read Tenant B's pricing rules | GET returns only own rules |
| TI-06 | Tenant A cannot access Tenant B's stores | GET returns only own stores |
| TI-07 | Tenant A cannot access Tenant B's suppliers | GET returns only own suppliers |
| TI-08 | New tenant starts with zero data | All list endpoints return empty |
| TI-09 | Tenant-scoped create injects correct tenantId | Created record has correct tenantId |
| TI-10 | Cross-tenant invoice upload is isolated | Upload creates invoice for correct tenant only |
| TI-11 | Cross-tenant matching is isolated | Match results scoped to tenant's products |
| TI-12 | Audit logs are tenant-scoped | Tenant A cannot see Tenant B's audit logs |
| TI-13 | Bulk operations are tenant-scoped | Bulk delete only affects own records |

### 3.2 Plan Gating (18 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| PG-01 | Starter plan accessing Gmail status | 403 PLAN_UPGRADE_REQUIRED |
| PG-02 | Starter plan configuring Gmail | 403 PLAN_UPGRADE_REQUIRED |
| PG-03 | Professional plan accessing Gmail status | 200 OK |
| PG-04 | Professional plan configuring Gmail | 200 OK |
| PG-05 | Starter plan accessing folder polling status | 403 PLAN_UPGRADE_REQUIRED |
| PG-06 | Professional plan accessing folder polling | 200 OK |
| PG-07 | Starter plan accessing competitor intel | 403 PLAN_UPGRADE_REQUIRED |
| PG-08 | Professional plan accessing competitor intel | 403 PLAN_UPGRADE_REQUIRED |
| PG-09 | Enterprise plan accessing competitor intel | 200 OK |
| PG-10 | SYSTEM_ADMIN bypasses plan gating | 200 OK regardless of plan |
| PG-11 | planHasFeature returns correct booleans | Unit test of config function |
| PG-12 | getPlanLimits returns correct limits per plan | Correct maxUsers, maxStores, maxApiCalls |
| PG-13 | Unknown plan returns no features | Empty feature set |
| PG-14 | All plans include base features | invoices, products, pricing, reports |
| PG-15 | Plan upgrade adds features | Professional gains Gmail + folder |
| PG-16 | Plan downgrade removes features | Professional to starter loses integrations |
| PG-17 | API limit enforced at plan threshold | 429 when limit exceeded |
| PG-18 | API limit resets monthly | New month allows calls again |

### 3.3 Feature Gating E2E (23 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| FG-01 | Starter tenant CRUD invoices | All CRUD operations succeed |
| FG-02 | Starter tenant CRUD products | All CRUD operations succeed |
| FG-03 | Starter tenant pricing rules | Create and list succeed |
| FG-04 | Professional tenant all starter features | All base features accessible |
| FG-05 | Professional tenant Gmail integration | Full Gmail workflow accessible |
| FG-06 | Professional tenant folder polling | Full folder workflow accessible |
| FG-07 | Enterprise tenant all professional features | All pro features accessible |
| FG-08 | Enterprise tenant competitor intelligence | Full competitor workflow accessible |
| FG-09 | Locked tenant receives 403 | All endpoints return 403 with lock reason |
| FG-10 | Unlocked tenant regains access | All endpoints work after unlock |
| FG-11–23 | Various cross-feature access patterns | Correct gating per plan |

### 3.4 Core API Integration (24 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| API-01 | Register new tenant | 201, creates Tenant + User |
| API-02 | Register duplicate email | 400 error |
| API-03 | Login with valid credentials | 200, returns JWT token |
| API-04 | Login with wrong password | 401 error |
| API-05 | GET /me with valid token | 200, returns user + tenant info |
| API-06 | GET /me with invalid token | 401 error |
| API-07 | Create invoice (upload) | 201, invoice in PROCESSING status |
| API-08 | List invoices | 200, returns paginated list |
| API-09 | Get invoice detail | 200, includes lines + matches |
| API-10 | Update invoice header | 200, fields updated |
| API-11 | Delete invoice | 200, cascade deletes lines + matches |
| API-12 | Create product | 201, product created |
| API-13 | List products with variants | 200, includes all store variants |
| API-14 | Search products by name | 200, fuzzy results returned |
| API-15 | Search products by barcode | 200, exact match |
| API-16 | Bulk delete products | 200, all specified products deleted |
| API-17 | Create pricing rule | 201, rule created with priority |
| API-18 | List pricing rules | 200, ordered by priority DESC |
| API-19 | Update pricing rule (OWNER) | 200, rule updated |
| API-20 | Update pricing rule (MERCHANDISER) | 403, insufficient role |
| API-21 | List stores | 200, returns tenant's stores |
| API-22 | Invoice counts for sidebar | 200, { total, needsReview } |
| API-23 | Dashboard stats | 200, KPI metrics |
| API-24 | Health check | 200, { status: 'ok' } |

### 3.5 Admin API (23 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| ADM-01 | Non-admin accessing admin routes | 403 error |
| ADM-02 | Admin platform overview stats | 200, tenant counts + API stats |
| ADM-03 | Admin recent activity | 200, access logs + registrations |
| ADM-04 | Admin list tenants (no filter) | 200, all tenants |
| ADM-05 | Admin list tenants (status filter) | 200, filtered list |
| ADM-06 | Admin list tenants (search) | 200, name/email match |
| ADM-07 | Admin get tenant detail | 200, full profile + logs + usage |
| ADM-08 | Admin create tenant | 201, tenant + owner created |
| ADM-09 | Admin update tenant | 200, fields updated |
| ADM-10 | Admin lock tenant | 200, isLocked=true |
| ADM-11 | Admin unlock tenant | 200, isLocked=false |
| ADM-12 | Admin change subscription | 200, plan + status updated |
| ADM-13 | Admin API usage (aggregated) | 200, usage by tenant |
| ADM-14 | Admin API usage (date filter) | 200, filtered usage |
| ADM-15 | Admin API call logs (paginated) | 200, call list with pagination |
| ADM-16 | Admin API call detail | 200, request/response payloads |
| ADM-17 | Admin get platform settings | 200, singleton settings |
| ADM-18 | Admin update platform settings | 200, settings updated |
| ADM-19 | Lock creates access log entry | TenantAccessLog record created |
| ADM-20 | Unlock creates access log entry | TenantAccessLog record created |
| ADM-21 | Plan change creates access log | TenantAccessLog record created |
| ADM-22 | Admin bypasses tenant lock | 200 even on locked tenant routes |
| ADM-23 | Admin bypasses plan gating | 200 for all feature-gated routes |

### 3.6 Matching Engine (32 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| ME-01 | Barcode exact match | Confidence 100, reason: barcode |
| ME-02 | SKU exact match | Confidence 100, reason: sku |
| ME-03 | Exact name match | Confidence 100, reason: fuzzy_name |
| ME-04 | Fuzzy name match (partial overlap) | Confidence 60–90, reason: fuzzy_name |
| ME-05 | Fuzzy match with stemming ("tomatoes" → "tomato") | Correct match |
| ME-06 | Fuzzy match with stop word removal | "The" / "and" ignored |
| ME-07 | Fuzzy match with hyphen normalization | "Semi-Dried" → "Semi Dried" |
| ME-08 | No match for unrelated description | Confidence 0, no match |
| ME-09 | Learned mapping match (SupplierProductMapping) | Confidence from saved mapping |
| ME-10 | Learned mapping takes priority over barcode | Strategy 1 checked first |
| ME-11 | Suggested price calculated on match | suggestedPrice populated |
| ME-12 | Match respects tenant scope | Only matches tenant's products |
| ME-13 | Manual match creates match record | isManual=true |
| ME-14 | Match confirmation updates line status | MATCHED → APPROVED |
| ME-15 | Cost tracking on match record | previousCost, newCost populated |
| ME-16 | Price change tracking | previousPrice, suggestedPrice, priceChange populated |
| ME-17–32 | Edge cases: special characters, empty descriptions, multi-word, case sensitivity, duplicate barcodes | Correct behavior per case |

### 3.7 Pricing Service (31 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| PS-01 | Global rule applies to any product | Suggested price = cost × (1 + margin) |
| PS-02 | Category rule overrides global | Category-specific margin applied |
| PS-03 | Supplier rule overrides category | Supplier-specific margin applied |
| PS-04 | Product rule overrides all | Product-specific margin applied |
| PS-05 | Round to .99 strategy | $4.50 → $4.99 |
| PS-06 | Round to .49/.99 strategy | $4.25 → $4.49, $4.75 → $4.99 |
| PS-07 | Round to nearest 5 cents | $4.52 → $4.50 |
| PS-08 | Max price jump enforced | Price increase capped at threshold |
| PS-09 | Min margin enforced | Price never drops below min margin |
| PS-10 | No rule found — no suggested price | suggestedPrice is null |
| PS-11 | Zero cost handling | Graceful handling, no division by zero |
| PS-12 | Negative margin detection | Warning or enforcement |
| PS-13–31 | Edge cases: very high margins, very low costs, multiple rules at same priority, rule priority ordering | Correct calculation per case |

### 3.8 Gmail Integration (31 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| GM-01 | Starter plan → 403 on Gmail status | PLAN_UPGRADE_REQUIRED |
| GM-02 | Starter plan → 403 on Gmail configure | PLAN_UPGRADE_REQUIRED |
| GM-03 | Professional plan → 200 on Gmail status | Status returned |
| GM-04 | Status returns connected=false initially | { connected: false } |
| GM-05 | Status returns connected=true with integration | Full details + stats |
| GM-06 | Save credentials encrypts and stores | Credentials saved encrypted |
| GM-07 | Configure sets sender whitelist | Whitelist stored |
| GM-08 | Configure sets label filter | Label stored |
| GM-09 | Configure sets poll interval | Interval stored |
| GM-10 | Test connection validates OAuth | Returns success/failure |
| GM-11 | Poll triggers Gmail search | Attempts poll, returns result |
| GM-12 | Import logs pagination | Page/limit/status filtering works |
| GM-13 | Disconnect removes integration | Integration deleted |
| GM-14 | Dedup by Gmail message ID | Duplicate message skipped |
| GM-15 | Dedup by file hash (SHA-256) | Duplicate file skipped |
| GM-16 | Dedup by content tuple | Same supplier+number+date skipped |
| GM-17 | hashFileBuffer produces consistent SHA-256 | Same input → same hash |
| GM-18 | hashFileBuffer different inputs → different hashes | Unique files get unique hashes |
| GM-19 | hashFileBuffer handles empty buffer | Returns valid hash |
| GM-20 | isDuplicateByMessageId detection | Returns true for existing ID |
| GM-21 | isDuplicateByHash detection | Returns true for existing hash |
| GM-22 | isDuplicateByContent detection | Returns true for matching tuple |
| GM-23 | Sender whitelist filtering | Only whitelisted senders processed |
| GM-24 | Sender whitelist empty allows all | No filter applied |
| GM-25–31 | Edge cases: expired tokens, malformed attachments, oversized files, concurrent polls | Graceful error handling |

### 3.9 Folder Polling Integration (36 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| FP-01 | Starter plan → 403 on folder status | PLAN_UPGRADE_REQUIRED |
| FP-02 | Starter plan → 403 on folder configure | PLAN_UPGRADE_REQUIRED |
| FP-03 | Professional plan → 200 on folder status | Status returned |
| FP-04 | Status returns connected=false initially | { connected: false } |
| FP-05 | Status returns connected=true with integration | Full details + stats |
| FP-06 | Test connection on valid folder with files | { success: true, fileCount: N } |
| FP-07 | Test connection on empty folder | { success: true, fileCount: 0 } |
| FP-08 | Test connection on non-existent path | { success: false, error } |
| FP-09 | Test connection on path with traversal | { success: false, error } |
| FP-10 | Configure saves folder path + patterns | Integration created |
| FP-11 | Configure validates path before saving | Invalid path rejected |
| FP-12 | Configure with custom file patterns | Custom patterns stored |
| FP-13 | Configure with custom poll interval | Interval stored |
| FP-14 | Configure rejects path with traversal | 400 error |
| FP-15 | Poll triggers folder scan and import | Stats returned |
| FP-16 | Poll returns file count and dedup stats | imported/duplicates/errors counted |
| FP-17 | Poll with OCR failure (test files aren't real PDFs) | Graceful error handling |
| FP-18 | Import logs pagination | Page/limit/status filtering works |
| FP-19 | Import logs status filter | Filter by imported/duplicate/error |
| FP-20 | Import logs empty when no imports | Empty list returned |
| FP-21 | Disconnect removes integration | Integration deleted |
| FP-22 | Disconnect when not connected | 404 error |
| FP-23 | validateFolderPath accepts absolute path | { valid: true } |
| FP-24 | validateFolderPath accepts UNC path | { valid: true } |
| FP-25 | validateFolderPath rejects relative path | { valid: false, error } |
| FP-26 | validateFolderPath rejects path traversal | { valid: false, error } |
| FP-27 | validateFolderPath rejects non-existent path | { valid: false, error } |
| FP-28 | validateFolderPath rejects file (not directory) | { valid: false, error } |
| FP-29 | scanFolder finds matching files only | PDF/JPG returned, TXT/DOCX excluded |
| FP-30 | scanFolder with default patterns | *.pdf, *.jpg, *.jpeg, *.png matched |
| FP-31 | scanFolder with custom patterns | Only specified extensions matched |
| FP-32 | scanFolder on empty folder | Empty array returned |
| FP-33 | scanFolder respects size limit (20 MB) | Oversized files excluded |
| FP-34 | hashFileBuffer consistent output | Same content → same hash |
| FP-35 | hashFileBuffer unique per content | Different content → different hash |
| FP-36 | hashFileBuffer handles empty buffer | Valid hash returned |

### 3.10 Signal Collector (15 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| SC-01 | Record prompt_meta signal | Signal buffered with baseVersionId, configId |
| SC-02 | Record correction_count signal | Consecutive user messages counted |
| SC-03 | Record usage signal | Tokens, latency, cost captured |
| SC-04 | Record outcome signal | Resolved/failed status recorded |
| SC-05 | Record satisfaction signal | User feedback score captured |
| SC-06 | Record escalation signal | Escalation event captured |
| SC-07 | Partial accumulation across multiple calls | Signals merge correctly for same conversation |
| SC-08 | Buffer flush writes to InteractionSignal table | DB records created on flush |
| SC-09 | Buffer respects max size limit | Overflow signals handled gracefully |
| SC-10 | Flush resolves agentRoleId from agentRoleKey | Correct FK populated |
| SC-11 | Empty buffer flush is no-op | No DB writes on empty buffer |
| SC-12 | Signal with unknown agentRoleKey | Graceful error handling, signal skipped |
| SC-13 | Concurrent signal emission | Thread-safe buffer management |
| SC-14 | Full conversation simulation | All signal types emitted correctly end-to-end |
| SC-15 | Buffer drain clears buffer after flush | Buffer empty after successful flush |

### 3.11 Suggestion Engine (16 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| SG-01 | Aggregate signals by topic | Correct grouping and counts |
| SG-02 | Aggregate signals by agent role | Per-agent breakdowns correct |
| SG-03 | Detect high override rate pattern | Flagged when override > 40% |
| SG-04 | Detect low satisfaction pattern | Flagged when avg satisfaction < 3.0 |
| SG-05 | Detect topic-specific failure | Topic with concentrated overrides identified |
| SG-06 | Cluster human overrides by type | wrong_product_match, no_match_found, price_override |
| SG-07 | Generate improvement proposals | LLM returns structured suggestions |
| SG-08 | Store suggestions with pending status | PromptSuggestion records created |
| SG-09 | Batch ID assigned to suggestion group | All suggestions in run share batchId |
| SG-10 | Auto-curate few-shot examples | High-satisfaction interactions selected |
| SG-11 | Skip tenants with insufficient signals | Minimum signal threshold enforced |
| SG-12 | No suggestions when no failure patterns | Empty result, no unnecessary LLM calls |
| SG-13 | Suggestion includes evidence references | Evidence cites specific topics and rates |
| SG-14 | Multiple agent roles processed independently | Each role has separate suggestions |
| SG-15 | Full pipeline end-to-end | Signals → patterns → suggestions complete |
| SG-16 | Suggestion deduplication | Similar suggestions not duplicated across runs |

### 3.12 Meta-Optimizer (11 tests)

| ID | Test Case | Expected Result |
|---|---|---|
| MO-01 | Cross-tenant statistics computation | Stats aggregated across tenants |
| MO-02 | Outperformer detection (15%+ improvement) | Tenants with custom configs beating defaults identified |
| MO-03 | Default vs customized tenant comparison | Correct baseline vs improved metrics |
| MO-04 | Generate default upgrade proposals | LLM proposes base prompt improvements |
| MO-05 | Create candidate PromptBaseVersion | New version created with isActive=false |
| MO-06 | Generate cross-tenant recommendations | Default tenants receive improvement suggestions |
| MO-07 | Canary rollout activation | New version activated for subset of tenants |
| MO-08 | Rollback candidate version | Reverts to previous active version |
| MO-09 | Multi-tenant simulation | Correct behavior with many tenants |
| MO-10 | Insufficient data handling | Graceful skip when too few signals |
| MO-11 | Existing tenant configs preserved on upgrade | Pinned baseVersionId not overwritten |

---

## 4. Integration Test Scenarios

### Scenario 1: First-Time Retailer Setup
```
1. Register new tenant (Starter plan)
2. Create 2 stores (POS + Ecommerce)
3. Import product catalog from Shopify CSV
4. Upload first invoice (PDF)
5. OCR extracts supplier + line items
6. Auto-match lines to imported products
7. Review matches, confirm, set approved prices
8. Approve invoice → cost/price updates applied
9. Export to POS format
```

### Scenario 2: Gmail Auto-Import (Professional)
```
1. Upgrade tenant to Professional plan
2. Enter Google Cloud Client ID/Secret
3. Complete OAuth consent flow
4. Configure sender whitelist (supplier emails)
5. Set poll interval to 30 minutes
6. Supplier sends invoice email with PDF attachment
7. Background scheduler detects new email
8. 3-layer dedup check passes (new invoice)
9. OCR extracts data → invoice created
10. User reviews in dashboard → matches → approves
```

### Scenario 3: Folder Polling Auto-Import (Professional)
```
1. Configure folder path: C:\Invoices
2. Set file patterns: *.pdf, *.jpg
3. Test connection → success (3 files found)
4. Save & enable with 30-minute interval
5. Place new invoice PDF in C:\Invoices
6. Background scheduler detects new file
7. 3-layer dedup check (path, hash, content)
8. OCR → invoice created → file moved to Processed/
9. Second poll: file in Processed/ not re-imported
```

### Scenario 4: Duplicate Detection Across Sources
```
1. Supplier sends invoice via email (Gmail import)
2. Same invoice PDF saved to watched folder
3. Folder polling imports file
4. Gmail polling detects same email attachment
5. Layer 2 (SHA-256 hash) catches duplicate
6. Import log shows "duplicate_hash" reason
```

### Scenario 5: Competitor Price Alert (Enterprise)
```
1. Upgrade to Enterprise plan
2. Create competitor monitor: Product X vs Woolworths
3. Record Woolworths price: $4.99
4. Product X current retail: $5.49
5. Record new Woolworths price: $3.99 (on special)
6. Generate alerts → "competitor_undercut" alert created
7. Review margin waterfall: cost $3.20, margin $2.29, competitor $3.99
8. Decide to adjust price or hold
```

### Scenario 6: Smart Product Import
```
1. Navigate to Products > Smart Import
2. Upload Shopify CSV file, system name auto-detected
3. AI agent analyses headers and sample rows
4. Agent proposes column mapping and parent/child grouping
5. User reviews mapping in right panel, adjusts if needed
6. Click "Test Import" → preview products and variants
7. Confirm import → products and variants created
8. Template auto-saved with file blueprint
9. Later: export with updated prices in original format
```

### Scenario 7: Prompt Evolution Lifecycle
```
1. New tenant onboards → assemblePrompt returns base version verbatim
2. Tenant uses advisor chat → signals captured (satisfaction, overrides)
3. Daily: suggestion engine detects high override rate on product matching
4. Suggestion generated: "Add instruction about size variants"
5. Tenant admin reviews in Settings > AI Agents → approves
6. TenantPromptConfig updated, cache invalidated
7. Next chat uses improved prompt → override rate drops
8. Weekly: meta-optimizer detects improvement → proposes base upgrade
9. Platform admin activates candidate with canary rollout
```

### Scenario 8: Invoice Statement Detection
```
1. Supplier sends monthly statement via email
2. Gmail polling picks up attachment
3. OCR classifies documentType as "statement"
4. Invoice auto-assigned DISCARDED status
5. Audit log entry: "Document discarded - type: statement"
6. Statement does NOT appear in review queue
7. Admin can see discarded documents in invoice list with filter
```

### Scenario 9: Multi-Tenant Admin Management
```
1. System admin views platform overview
2. 50 tenants: 30 active, 15 trial, 3 locked, 2 expired
3. Admin searches for "Smith Retail"
4. Opens tenant detail → sees 3 users, 150 API calls this month
5. Trial expires → auto-lock triggers
6. Admin manually unlocks with grace period
7. Admin changes plan from Starter to Professional
8. Tenant now has Gmail + folder polling access
```

---

## 5. Non-Functional Test Cases

### Security
| ID | Test Case | Expected Result |
|---|---|---|
| SEC-01 | Request without JWT token | 401 Unauthorized |
| SEC-02 | Request with expired JWT | 401 Unauthorized |
| SEC-03 | Request with malformed JWT | 401 Unauthorized |
| SEC-04 | Tenant A's token on Tenant B's data | 404 (not found in scoped query) |
| SEC-05 | Non-admin on admin routes | 403 Forbidden |
| SEC-06 | Locked tenant accessing API | 403 with lock reason |
| SEC-07 | Path traversal in folder config | Rejected with error |
| SEC-08 | SQL injection in search params | Parameterized queries prevent injection |

### Performance
| ID | Test Case | Expected Result |
|---|---|---|
| PERF-01 | OCR completes within 30 seconds | Response time < 30s |
| PERF-02 | Product search returns within 500ms | Response time < 500ms |
| PERF-03 | Dashboard stats query under 1 second | Response time < 1s |
| PERF-04 | Background scheduler doesn't block requests | API responsive during polling |

### Reliability
| ID | Test Case | Expected Result |
|---|---|---|
| REL-01 | API usage logging is non-blocking | Request completes even if logging fails |
| REL-02 | Scheduler overlap prevention | isRunning guard prevents concurrent runs |
| REL-03 | OCR failure doesn't crash server | Invoice marked FAILED, error logged |
| REL-04 | Gmail token refresh on expiry | Auto-refresh using refresh token |
