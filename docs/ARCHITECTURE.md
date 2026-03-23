# RetailEdge — Architecture Document

## 1. System Overview

RetailEdge is a monorepo web application with a React 19 single-page application (SPA) frontend and an Express 5 REST API backend, backed by PostgreSQL 16 with Prisma 7 ORM. The platform uses a multi-tenant architecture with both application-level and database-level tenant isolation.

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (React 19)                     │
│  Vite 7 · Tailwind CSS 4 · React Router 7 · xlsx            │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────┐   │
│  │ Pages       │ │ Components  │ │ Services / Hooks     │   │
│  │ Dashboard   │ │ Layout      │ │ api.js (HTTP client)  │   │
│  │ Invoices    │ │ Settings    │ │ useTenantPlan hook    │   │
│  │ Review      │ │ Competitor  │ │ useChat hook          │   │
│  │ BatchReview │ │ Advisor/*   │ │                       │   │
│  │ Export      │ │ Review/*    │ │                       │   │
│  │ Products    │ │ UpgradePmt  │ │                       │   │
│  │ Pricing     │ │             │ │                       │   │
│  │ Settings    │ │             │ │                       │   │
│  │ Competitor  │ │             │ │                       │   │
│  │ BizAdvisor  │ │             │ │                       │   │
│  │ Admin/*     │ │             │ │                       │   │
│  └─────────────┘ └─────────────┘ └──────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP/JSON (JWT Bearer)
┌───────────────────────────▼─────────────────────────────────┐
│                     Server (Express 5)                       │
│  Node.js · ES Modules · Prisma 7 · JWT · AES-256-GCM        │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Middleware Pipeline                                  │     │
│  │ cors → json → authenticate → tenantAccess →          │     │
│  │ tenantScope → requirePlan → [route handler]          │     │
│  └─────────────────────────────────────────────────────┘     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐     │
│  │ Routes       │ │ Services       │ │ Background Jobs    │   │
│  │ auth         │ │ ocr            │ │ gmailScheduler     │   │
│  │ invoices     │ │ invoiceProc    │ │ folderScheduler    │   │
│  │ products     │ │ matching       │ │ signalCollector    │   │
│  │ pricing      │ │ pricing        │ │ conversationClnup  │   │
│  │ stores       │ │ gmail          │ │                    │   │
│  │ gmail        │ │ folder         │ │                    │   │
│  │ folder       │ │ shopifyImp     │ │                    │   │
│  │ competitor   │ │ apiTracker     │ │                    │   │
│  │ chat         │ │ agents/*       │ │                    │   │
│  │ product-imp  │ │ promptAssembly │ │                    │   │
│  │ suggestions  │ │ signalCollect  │ │                    │   │
│  │ drive        │ │ suggestionEng  │ │                    │   │
│  │ prompts      │ │ metaOptimizer  │ │                    │   │
│  │ prompt-chat  │ │ productImpAgt  │ │                    │   │
│  │ admin/*      │ │ drive          │ │                    │   │
│  └──────────────┘ └────────────────┘ └────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ Prisma Client (tenant-scoped)
┌───────────────────────────▼─────────────────────────────────┐
│                   PostgreSQL 16 (Docker)                      │
│  Row-Level Security · 40+ Models · Indexes · RLS Policies    │
└─────────────────────────────────────────────────────────────┘

External Services:
  ┌──────────────┐  ┌──────────────┐
  │ Claude API   │  │ Gmail API    │
  │ (Anthropic)  │  │ (Google)     │
  │ OCR + Match  │  │ OAuth + Poll │
  └──────────────┘  └──────────────┘
```

---

## 2. Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 19.2.0 | UI framework |
| Vite | 7.3.1 | Build tool and dev server |
| Tailwind CSS | 4.2.1 | Utility-first styling |
| React Router | 7.13.1 | Client-side routing |
| xlsx | 0.18.5 | Spreadsheet parsing for product import |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Node.js | ES Modules | Runtime |
| Express | 5.1.0 | HTTP framework |
| Prisma | 7.4.2 | ORM with PostgreSQL adapter |
| @prisma/adapter-pg | — | PostgreSQL driver for Prisma |
| jsonwebtoken | 9.0.2 | JWT creation and verification |
| bcryptjs | 2.4.3 | Password hashing |
| @anthropic-ai/sdk | 0.78.0 | Claude API (OCR + matching) |
| googleapis | — | Gmail API (OAuth + polling) |
| multer | 2.0.1 | File upload handling |
| node-cron | 4.2.1 | Background job scheduling |
| xlsx | 0.18.5 | Spreadsheet parsing |

### Infrastructure
| Technology | Version | Purpose |
|---|---|---|
| PostgreSQL | 16-alpine | Primary database (Docker) |
| Docker Compose | — | Local development orchestration |
| concurrently | — | Parallel dev server runner |

### Testing
| Technology | Purpose |
|---|---|
| vitest | Test runner |
| supertest | HTTP endpoint testing |

---

## 3. Multi-Tenancy Architecture

RetailEdge implements **two-layer tenant isolation**:

### Layer 1: Application-Level (Prisma Extension)

Every authenticated request flows through the `tenantScope` middleware, which creates a tenant-scoped Prisma client using `$extends`. This client automatically injects `WHERE tenantId = ?` on all reads and `SET tenantId = ?` on all writes.

```
Request → authenticate → tenantAccess → tenantScope → route handler
                                            │
                                            ▼
                              req.prisma = basePrisma.$extends({
                                query: {
                                  $allModels: {
                                    // Inject tenantId on every operation
                                  }
                                }
                              })
```

### Layer 2: Database-Level (PostgreSQL RLS)

PostgreSQL Row-Level Security policies provide defense-in-depth. Each connection sets a session variable (`app.current_tenant_id`) and RLS policies ensure queries only return rows belonging to that tenant.

### Scoped Models
Direct scoping (have `tenantId` column): User, Store, Product, Supplier, Invoice, PricingRule, AuditLog, ImportTemplate, GmailIntegration, GmailImportLog, FolderIntegration, FolderImportLog, CompetitorMonitor, CompetitorPrice, PriceAlert, SupplierProductMapping

Transitive protection (via foreign keys): ProductVariant, InvoiceLine, InvoiceLineMatch

---

## 4. Authentication & Authorization

### JWT Flow
```
1. POST /api/auth/login  →  { email, password }
2. Server validates credentials  →  bcrypt.compare()
3. Server issues JWT  →  { userId, tenantId, role, exp: 7d }
4. Client stores token  →  localStorage
5. All requests include  →  Authorization: Bearer <token>
```

### Role Hierarchy
| Role | Scope | Capabilities |
|---|---|---|
| SYSTEM_ADMIN | Platform-wide | All admin operations, bypass tenant access checks |
| OWNER | Tenant | Full tenant management, pricing rules, user management |
| OPS_MANAGER | Tenant | Invoice processing, product management, pricing rules |
| MERCHANDISER | Tenant | Product management, pricing review |
| STORE_MANAGER | Tenant | Store-specific operations |
| ACCOUNTANT | Tenant | Invoice review and export |

### Middleware Chain
```
1. authenticate       — Verify JWT, set req.user
2. tenantAccess       — Check tenant.isLocked (SYSTEM_ADMIN bypasses)
3. tenantScope        — Inject req.prisma (tenant-scoped), set req.tenantId
4. requirePlan(feat)  — Check plan includes feature (SYSTEM_ADMIN bypasses)
5. requireRole(roles) — Check user role (admin routes only)
6. checkApiLimit      — Enforce monthly API call quota
```

---

## 5. Feature Gating

Feature gating uses a plan-based system defined in `server/src/config/plans.js`:

```
starter:      [invoices, products, pricing, reports]
professional: [invoices, products, pricing, reports, gmail_integration, folder_polling]
enterprise:   [invoices, products, pricing, reports, gmail_integration, folder_polling, competitor_intelligence]
```

The `requirePlan(feature)` middleware returns `403 PLAN_UPGRADE_REQUIRED` if the tenant's plan does not include the requested feature. The client uses the `useTenantPlan()` hook to conditionally render UI elements and show upgrade prompts.

---

## 6. Invoice Processing Pipeline

```
┌──────────────────────────────────────────────────────────┐
│                    INGESTION SOURCES                      │
│                                                          │
│  ┌────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │  Manual     │  │  Gmail Polling  │  │ Folder Polling│  │
│  │  Upload     │  │  (Background)   │  │ (Background)  │  │
│  └─────┬──────┘  └───────┬────────┘  └──────┬────────┘  │
│        │                 │                   │           │
│        │     ┌───────────▼───────────┐       │           │
│        │     │  3-Layer Dedup Check   │◄──────┘           │
│        │     │  1. Source ID          │                   │
│        │     │  2. SHA-256 Hash       │                   │
│        │     │  3. Content Tuple      │                   │
│        │     └───────────┬───────────┘                   │
└──────────────────────────┼───────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    OCR EXTRACTION                         │
│                                                          │
│  Claude Vision (Sonnet 4)                                │
│  Input:  PDF / JPG / PNG / WebP                          │
│  Output: Supplier, Invoice #, Dates, Totals, GST,       │
│          Freight, Line Items[], Confidence Score          │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│                 INVOICE PROCESSING                        │
│                                                          │
│  1. Create/link Supplier record                          │
│  2. Allocate freight across lines (3 methods)            │
│  3. Handle GST (inclusive vs exclusive)                   │
│  4. Parse pack sizes → base unit quantities              │
│  5. Calculate baseUnitCost (ex-GST, per unit)            │
│  Status: PROCESSING → READY                              │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│                  PRODUCT MATCHING                         │
│                                                          │
│  Strategy 1: Learned Supplier-Product Mappings           │
│          ↓ (no match)                                    │
│  Strategy 2: Barcode Exact Match                         │
│          ↓ (no match)                                    │
│  Strategy 3: Fuzzy Name (Jaccard + Stemming)             │
│          ↓ (confidence < 80%)                            │
│  Strategy 4: AI Fallback (Claude)                        │
│                                                          │
│  Output: Match records with confidence + reason          │
│  Status: READY → IN_REVIEW                               │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│                   PRICING ENGINE                          │
│                                                          │
│  1. Find applicable rule (PRODUCT > SUPPLIER > CAT > GL) │
│  2. Calculate suggested price from new cost + target %   │
│  3. Apply rounding strategy (.99 / .49,.99 / nearest 5)  │
│  4. Enforce max price jump limit                         │
│  5. Enforce minimum margin floor                         │
│                                                          │
│  User reviews → confirms → overrides if needed           │
│  Status: IN_REVIEW → APPROVED                            │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│                      EXPORT                               │
│                                                          │
│  Invoice tables: "Ready to Export" / "Previously         │
│    Exported" with sortable Last Exported column           │
│  Per-system export checkboxes: POS, Shopify, Instore     │
│  Duplicate POS detection: modal to choose price          │
│  Only exports items where cost/price changed             │
│  Inline price editing → mark as exported                 │
│  Re-export support for previously exported invoices      │
│  Output: POS CSV, Shopify CSV, INSTORE_UPDATE.xlsx       │
│  Status: APPROVED → EXPORTED                             │
└──────────────────────────────────────────────────────────┘
```

---

## 7. Integration Architecture

### 7.1 Gmail Integration

```
┌─────────┐    OAuth 2.0     ┌──────────────┐
│  Tenant  │ ──────────────► │ Google Cloud  │
│  (UI)    │  Client ID/     │ Console      │
│          │  Secret (own)   │              │
└────┬─────┘                 └──────┬───────┘
     │ Save encrypted                │ Auth code
     ▼                               ▼
┌─────────────────────────────────────────────┐
│              RetailEdge Server               │
│                                             │
│  GmailIntegration (per-tenant):             │
│  ├─ googleClientId (encrypted)              │
│  ├─ googleClientSecret (encrypted)          │
│  ├─ accessToken (encrypted)                 │
│  ├─ refreshToken (encrypted)                │
│  ├─ senderWhitelist[]                       │
│  ├─ labelFilter                             │
│  └─ pollIntervalMin (default: 30)           │
│                                             │
│  gmailScheduler (node-cron, every 5 min):   │
│  └─ For each active tenant:                 │
│       If lastPollAt + interval elapsed:     │
│       └─ pollGmailForInvoices()             │
│           ├─ Search: has:attachment label:X  │
│           ├─ Extract PDF/image attachments   │
│           ├─ 3-layer dedup                  │
│           ├─ OCR → create Invoice           │
│           └─ Log to GmailImportLog          │
└─────────────────────────────────────────────┘
```

### 7.2 Folder Polling Integration

```
┌─────────────────────────────────────────────┐
│              RetailEdge Server               │
│                                             │
│  FolderIntegration (per-tenant):            │
│  ├─ folderPath (local or UNC)               │
│  ├─ filePatterns[] (*.pdf, *.jpg, etc.)     │
│  ├─ pollIntervalMin (default: 30)           │
│  └─ moveToProcessed (default: true)         │
│                                             │
│  folderScheduler (node-cron, every 5 min):  │
│  └─ For each active tenant:                 │
│       If lastPollAt + interval elapsed:     │
│       └─ pollFolderForInvoices()            │
│           ├─ validateFolderPath()           │
│           ├─ scanFolder() (top-level only)  │
│           ├─ For each matching file:        │
│           │   ├─ 3-layer dedup              │
│           │   ├─ OCR → create Invoice       │
│           │   └─ moveToProcessed()          │
│           └─ Log to FolderImportLog         │
└──────────┬──────────────────────────────────┘
           │ fs.readdir / fs.readFile / fs.rename
           ▼
┌──────────────────────────┐
│  Local / Network Folder  │
│  C:\Invoices\            │
│  ├─ invoice-001.pdf      │
│  ├─ receipt.jpg          │
│  └─ Processed/           │
│      ├─ invoice-001.pdf  │
│      └─ receipt.jpg      │
└──────────────────────────┘
```

### 7.3 Claude AI Integration

```
┌──────────────────────────────────────────────┐
│              RetailEdge Server                │
│                                              │
│  trackedClaudeCall() wrapper:                │
│  ├─ Calls Anthropic SDK                      │
│  ├─ Logs to ApiUsageLog (async, non-block)   │
│  └─ Calculates cost per model                │
│                                              │
│  Use Cases:                                  │
│  ├─ OCR: extractInvoiceData() [Sonnet 4]     │
│  │   Vision API with PDF/image input         │
│  │   Returns structured invoice data         │
│  │                                           │
│  ├─ Matching: AI fallback [Sonnet 4]         │
│  │   When fuzzy confidence < 80%             │
│  │   Suggests best product match             │
│  │                                           │
│  ├─ Business Advisor: AI chat agent           │
│  │   Streaming SSE responses                  │
│  │   Orchestrator + domain-specific tools     │
│  │   Tools: invoice, product, pricing,        │
│  │          competitor analysis                │
│  │   Conversation history (DB-persisted)      │
│  │                                            │
│  └─ Pricing: AI recommendation [placeholder] │
│      Market-based suggestions (future)       │
└──────────────┬───────────────────────────────┘
               │ HTTPS
               ▼
┌──────────────────────────┐
│     Anthropic API        │
│  claude-sonnet-4         │
│  claude-haiku-3.5        │
└──────────────────────────┘
```

### 7.4 Prompt Evolution System (3-Tier)

The Prompt Evolution System provides a continuous improvement pipeline for all AI agent prompts. It operates in three tiers:

```
┌──────────────────────────────────────────────────────────────────┐
│                    PROMPT EVOLUTION SYSTEM                        │
│                                                                  │
│  TIER 1: Versioned Base Prompts                                  │
│  ├─ AgentRole (business_advisor, product_matching, ocr_extract)  │
│  ├─ PromptBaseVersion (versioned system prompts per role)        │
│  └─ Managed by platform admins, canary rollout support           │
│                                                                  │
│  TIER 2: Per-Tenant Config Overrides                             │
│  ├─ TenantPromptConfig (custom instructions, tone, terminology)  │
│  ├─ TenantFewShotExample (curated examples per agent)            │
│  └─ Managed by tenant admins via Settings > AI Agents            │
│                                                                  │
│  TIER 3: Meta-Optimization (Cross-Tenant Learning)               │
│  ├─ metaOptimizer.js — compares default vs customized tenants    │
│  ├─ Identifies outperformers (15%+ improvement)                  │
│  └─ Proposes base prompt upgrades with canary rollout            │
└──────────────────────────────────────────────────────────────────┘

Assembly Pipeline (promptAssemblyEngine.js — 6 steps):
  1. Load base prompt (PromptBaseVersion for agent role)
  2. Load tenant config (TenantPromptConfig, if exists)
  3. Merge: tone + custom instructions + domain terminology
  4. Select few-shot examples (top 3 by quality score)
  5. Inject runtime context (date, available tools)
  6. Return assembled prompt with metadata + cache

Signal Capture (signalCollector.js):
  ├─ 6 signal types: prompt_meta, correction_count, usage,
  │   outcome, satisfaction, escalation
  ├─ Async buffer with 5-second flush interval
  └─ Writes InteractionSignal records to DB

Suggestion Engine (suggestionEngine.js — daily):
  ├─ Aggregates signals per tenant per agent
  ├─ Detects failure patterns (high override, low satisfaction)
  ├─ Generates improvement proposals via LLM
  └─ Stores PromptSuggestion (status: pending → approved/rejected)

Conversation Cleanup (conversationCleanup.js):
  └─ Detects abandoned conversations (no activity for 30+ min)
```

### 7.5 Smart Product Import Agent

AI-powered product catalog import that works with any file format (Shopify, Lightspeed, WooCommerce, generic CSV/XLSX).

```
┌──────────────────────────────────────────────────────────────────┐
│                  SMART PRODUCT IMPORT                             │
│                                                                  │
│  Upload → Analyse → Chat → Test → Import → Export                │
│                                                                  │
│  productImportAgent.js:                                          │
│  ├─ Claude analyses file structure (headers, sample rows)        │
│  ├─ Generic parent/child row grouping engine                     │
│  ├─ System name captured at upload for round-trip export         │
│  └─ Template auto-saved with complete file blueprint             │
│                                                                  │
│  UI: Split-screen chat (SmartImport.jsx)                         │
│  ├─ Left panel: Agent conversation                               │
│  ├─ Right panel: Column mapping, patterns, test results          │
│  └─ Test run shows preview before actual import                  │
│                                                                  │
│  Export: Reconstruct original file format with updated prices    │
│  └─ Uses saved template blueprint for format fidelity            │
│                                                                  │
│  Route: /api/product-import/*                                    │
│  Endpoints: upload, chat, test, confirm, export, session         │
└──────────────────────────────────────────────────────────────────┘
```

### 7.6 Invoice Statement Detection

OCR now classifies document type during extraction:
- Supported types: `invoice`, `statement`, `credit_note`, `purchase_order`, `receipt`, `unknown`
- Non-invoice documents are automatically assigned `DISCARDED` status
- Audit log entry created for each discarded document
- Works across all ingestion paths (manual upload, Gmail, folder polling, Google Drive)

---

## 8. Data Model (Entity Relationships)

```
Tenant (1) ──── (*) User
   │
   ├──── (*) Store ──── (*) ProductVariant
   │                          │
   ├──── (*) Product ────────┘
   │         │
   │         ├──── (*) CompetitorMonitor ──── (*) CompetitorPrice
   │         │
   │         └──── (*) PriceAlert
   │
   ├──── (*) Supplier ──── (*) SupplierProductMapping
   │
   ├──── (*) Invoice
   │         │
   │         └──── (*) InvoiceLine
   │                    │
   │                    └──── (*) InvoiceLineMatch
   │
   ├──── (*) PricingRule
   │
   ├──── (*) AuditLog
   │
   ├──── (*) ImportTemplate
   │
   ├──── (1) GmailIntegration ──── (*) GmailImportLog
   │
   ├──── (1) FolderIntegration ──── (*) FolderImportLog
   │
   ├──── (*) ApiUsageLog
   │
   ├──── (*) Conversation ──── (*) Message
   │         (+ resolutionStatus, topicTags, agentRoleKey)
   │
   ├──── (*) TenantPromptConfig ──── (*) TenantFewShotExample
   │
   └──── (*) InteractionSignal

Platform-wide (no tenant):
   PlatformSettings (singleton)
   TenantAccessLog
   AgentRole ──── (*) PromptBaseVersion
              └── (*) PromptSuggestion
              └── (*) PromptAuditLog

Prompt Management (Phase 1 — legacy, coexists with evolution system):
   AgentType ──── (*) PromptTemplate ──── (*) PromptCondition
              └── (*) TenantPromptOverride
              └── (*) PromptConflict
              └── (*) PromptChangeLog
```

---

## 9. Security Architecture

### Encryption
| Data | Method | Key |
|---|---|---|
| Passwords | bcrypt (salt rounds: 10) | — |
| Gmail OAuth tokens | AES-256-GCM | ENCRYPTION_KEY env var |
| Google Client ID/Secret | AES-256-GCM | ENCRYPTION_KEY env var |

### API Security
- JWT tokens with 7-day expiry
- Plan-based API rate limiting (monthly quotas)
- Tenant lock mechanism (admin can lock out tenant)
- CORS enabled for allowed origins
- File upload size limit (10 MB JSON body, 20 MB files via multer)

### Path Security (Folder Polling)
- Absolute path enforcement (no relative paths)
- Directory traversal prevention (`..` detection before path normalization)
- File system accessibility verification (`fs.access`)
- Directory type validation (`stat.isDirectory()`)

---

## 10. Background Job Architecture

Two background schedulers run as in-process cron jobs (via `node-cron`):

```
┌────────────────────────────────────────────────┐
│            Background Schedulers                │
│                                                │
│  gmailScheduler (cron: every 5 minutes)        │
│  ├─ isRunning guard (prevent overlap)          │
│  ├─ Query all active GmailIntegrations         │
│  ├─ For each: check lastPollAt + interval      │
│  └─ If due: pollGmailForInvoices()             │
│                                                │
│  folderScheduler (cron: every 5 minutes)       │
│  ├─ isRunning guard (prevent overlap)          │
│  ├─ Query all active FolderIntegrations        │
│  ├─ For each: check lastPollAt + interval      │
│  └─ If due: pollFolderForInvoices()            │
│                                                │
│  signalCollector (interval: every 5 seconds)    │
│  ├─ Flushes buffered InteractionSignals to DB  │
│  ├─ Resolves agentRoleId from agentRoleKey     │
│  └─ Non-blocking, fire-and-forget pattern      │
│                                                │
│  conversationCleanup (scheduled: periodic)     │
│  ├─ Detects abandoned conversations            │
│  ├─ No activity for 30+ minutes                │
│  └─ Updates resolutionStatus accordingly       │
│                                                │
│  Both ingestion schedulers:                    │
│  ├─ Run in the same Express process            │
│  ├─ Started in app.listen() callback           │
│  ├─ Use isRunning flag to prevent overlap      │
│  └─ Find a user per tenant for audit tracking  │
└────────────────────────────────────────────────┘
```

---

## 11. Deployment Architecture (Local Development)

```
┌────────────────────────────────────┐
│         Docker Compose             │
│                                    │
│  ┌────────────────────────────┐    │
│  │  PostgreSQL 16 (alpine)    │    │
│  │  Port: 5433                │    │
│  │  Databases:                │    │
│  │  ├─ retailedge (main)      │    │
│  │  └─ retailedge_test (test) │    │
│  │  Users:                    │    │
│  │  ├─ retailedge (superuser) │    │
│  │  └─ retailedge_app (RLS)   │    │
│  └────────────────────────────┘    │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│    concurrently (npm run dev)      │
│                                    │
│  ┌────────────────┐ ┌───────────┐  │
│  │ Vite Dev Server│ │ Express   │  │
│  │ Port: 5173     │ │ Port: 3001│  │
│  │ (client)       │ │ (server)  │  │
│  └────────────────┘ └───────────┘  │
└────────────────────────────────────┘
```

---

## 12. Directory Structure

```
retail-store-management/
├── client/
│   ├── src/
│   │   ├── App.jsx                    # Route configuration
│   │   ├── pages/                     # Page components
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Invoices.jsx
│   │   │   ├── InvoiceDetail.jsx
│   │   │   ├── Review.jsx
│   │   │   ├── BatchReview.jsx
│   │   │   ├── Export.jsx
│   │   │   ├── BusinessAdvisor.jsx
│   │   │   ├── Products.jsx
│   │   │   ├── Pricing.jsx
│   │   │   ├── Settings.jsx
│   │   │   ├── CompetitorIntelligence.jsx
│   │   │   ├── AIDashboard.jsx
│   │   │   └── admin/
│   │   │       ├── AdminOverview.jsx
│   │   │       ├── AdminTenants.jsx
│   │   │       ├── AdminTenantDetail.jsx
│   │   │       ├── AdminApiUsage.jsx
│   │   │       └── AdminSubscriptions.jsx
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppLayout.jsx
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   ├── TopBar.jsx
│   │   │   │   ├── WorkflowBreadcrumb.jsx
│   │   │   │   └── AdminLayout.jsx
│   │   │   ├── advisor/
│   │   │   │   ├── ChatPanel.jsx       # Main advisor chat interface
│   │   │   │   ├── ChatInput.jsx       # Message input with suggestions
│   │   │   │   ├── ChatMessage.jsx     # Individual message rendering
│   │   │   │   ├── StreamingMessage.jsx# SSE streaming display
│   │   │   │   ├── ConversationList.jsx# Chat history sidebar
│   │   │   │   ├── QuickActions.jsx    # Predefined action buttons
│   │   │   │   └── MessageFeedback.jsx # Thumbs up/down feedback
│   │   │   ├── review/
│   │   │   │   └── InvoiceSidePanel.jsx# Invoice detail overlay
│   │   │   ├── chat/                  # Smart Import chat UI
│   │   │   ├── products/
│   │   │   │   └── ProductRow.jsx     # Expandable variant rows
│   │   │   ├── settings/
│   │   │   │   ├── IntegrationsTab.jsx
│   │   │   │   └── AIAgentsTab.jsx    # Per-agent prompt config
│   │   │   ├── competitor/
│   │   │   │   └── CompetitorDashboard.jsx
│   │   │   └── UpgradePrompt.jsx
│   │   ├── services/
│   │   │   └── api.js                 # HTTP client
│   │   └── hooks/
│   │       ├── useTenantPlan.js       # Feature gating hook
│   │       └── useChat.js             # AI advisor chat hook (SSE streaming)
│   ├── public/
│   │   └── gmail-setup-guide.html     # Gmail configuration guide
│   └── vite.config.js
├── server/
│   ├── src/
│   │   ├── app.js                     # Express setup + route mounting
│   │   ├── middleware/
│   │   │   ├── auth.js                # JWT + requireRole
│   │   │   ├── tenantAccess.js        # Lock check
│   │   │   ├── tenantScope.js         # Prisma tenant scoping
│   │   │   ├── requirePlan.js         # Feature gating
│   │   │   └── apiLimiter.js          # API quota enforcement
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── invoices.js
│   │   │   ├── products.js
│   │   │   ├── pricing.js
│   │   │   ├── stores.js
│   │   │   ├── gmail.js
│   │   │   ├── folder.js
│   │   │   ├── competitor.js
│   │   │   ├── chat.js                # AI advisor chat (SSE streaming)
│   │   │   ├── drive.js               # Google Drive integration
│   │   │   ├── productImport.js       # Smart product import
│   │   │   ├── suggestions.js         # Tenant suggestion review
│   │   │   ├── prompts.js             # Prompt management
│   │   │   ├── promptChat.js          # Prompt chat
│   │   │   └── admin/
│   │   │       ├── overview.js
│   │   │       ├── tenants.js
│   │   │       ├── apiUsage.js
│   │   │       ├── settings.js
│   │   │       ├── tiers.js
│   │   │       ├── prompts.js
│   │   │       └── metaOptimizer.js   # Cross-tenant optimization
│   │   ├── services/
│   │   │   ├── ocr.js                 # Claude Vision OCR
│   │   │   ├── invoiceProcessor.js    # Apply OCR + cost allocation
│   │   │   ├── matching.js            # Four-strategy product matching
│   │   │   ├── pricing.js             # Margin-based pricing engine
│   │   │   ├── shopifyImport.js       # Variant-aware import
│   │   │   ├── gmail.js               # OAuth + polling + dedup
│   │   │   ├── gmailScheduler.js      # Background Gmail sync
│   │   │   ├── folder.js              # Path validation + polling + dedup
│   │   │   ├── folderScheduler.js     # Background folder sync
│   │   │   ├── apiUsageTracker.js     # Claude API call logging
│   │   │   ├── promptAssemblyEngine.js # 6-step prompt assembly
│   │   │   ├── signalCollector.js    # Async signal buffer + flush
│   │   │   ├── suggestionEngine.js   # Per-tenant improvement analysis
│   │   │   ├── metaOptimizer.js      # Cross-tenant learning
│   │   │   ├── conversationCleanup.js # Abandoned conversation detection
│   │   │   ├── productImportAgent.js # AI-powered product import
│   │   │   ├── promptComposer.js     # Prompt composition (legacy)
│   │   │   ├── promptConflictDetector.js # Conflict detection (legacy)
│   │   │   ├── promptValidators.js   # Prompt validation (legacy)
│   │   │   ├── promptChatAgent.js    # Prompt chat agent (legacy)
│   │   │   ├── drive.js              # Google Drive integration
│   │   │   └── agents/
│   │   │       ├── orchestrator.js    # AI agent orchestrator
│   │   │       ├── toolExecutor.js    # Tool dispatch for agent
│   │   │       └── tools/
│   │   │           ├── invoiceTools.js    # Invoice analysis tools
│   │   │           ├── productTools.js    # Product catalog tools
│   │   │           ├── pricingTools.js    # Pricing analysis tools
│   │   │           └── competitorTools.js # Competitor intel tools
│   │   ├── lib/
│   │   │   ├── prisma.js              # Tenant-scoped Prisma client
│   │   │   └── encryption.js          # AES-256-GCM encrypt/decrypt
│   │   └── config/
│   │       └── plans.js               # Plan definitions + feature gating
│   ├── prisma/
│   │   ├── schema.prisma              # Database schema (40+ models)
│   ├── seed-prompts.js            # Seed prompt data
│   ├── seed-prompt-evolution.js   # Seed AgentRoles + base versions
│   │   └── migrations/                # Prisma migrations
│   ├── tests/
│   │   ├── helpers/
│   │   │   ├── prisma.js              # Test DB client + cleanDatabase()
│   │   │   └── fixtures.js            # Test data factories
│   │   ├── admin-api.test.js
│   │   ├── api-integration.test.js
│   │   ├── feature-gating-e2e.test.js
│   │   ├── folder-integration.test.js
│   │   ├── gmail-integration.test.js
│   │   ├── matching-engine.test.js
│   │   ├── plan-gating.test.js
│   │   ├── pricing-service.test.js
│   │   ├── tenant-isolation.test.js
│   │   ├── signal-collector.test.js   # Signal capture (15 tests)
│   │   ├── suggestion-engine.test.js  # Suggestion engine (16 tests)
│   │   └── meta-optimizer.test.js     # Meta-optimizer (11 tests)
│   └── vitest.config.js
├── docs/
│   ├── ARCHITECTURE.md                # This document
│   ├── BUSINESS_REQUIREMENTS.md
│   ├── TEST_CASES.md
│   ├── SEQUENCE_DIAGRAMS.md
│   ├── PROMPT-EVOLUTION-SYSTEM.md     # Complete prompt evolution docs
│   ├── BUSINESS_AI_AGENT_DESIGN.md    # AI agent system design
│   ├── BUSINESS_AI_AGENT_IMPLEMENTATION_PLAN.md
│   ├── GMAIL_SETUP.md
│   └── backlog/
│       ├── stripe-integration.md
│       └── omnisend-klaviyo-integration.md
├── docker-compose.yml
└── package.json
```
