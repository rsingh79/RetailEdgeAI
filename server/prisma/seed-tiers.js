/**
 * Seed script for Features, Plan Tiers, Tier Limits, and Tenant migration.
 *
 * Run:  node prisma/seed-tiers.js
 *
 * Safe to re-run — uses upsert for features and tiers.
 */
import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL,
});

// ── Feature definitions ──────────────────────────────────────────────

const FEATURES = [
  // Core features (always included in every tier)
  { key: 'invoices',           name: 'Invoices',                category: 'core',          icon: '🧾', isCore: true,  sortOrder: 1 },
  { key: 'products',           name: 'Products',                category: 'core',          icon: '📦', isCore: true,  sortOrder: 2 },
  { key: 'review_match',       name: 'Review & Match',          category: 'core',          icon: '📋', isCore: true,  sortOrder: 3 },
  { key: 'export',             name: 'Export',                   category: 'core',          icon: '📤', isCore: true,  sortOrder: 4 },
  { key: 'ai_command_centre',  name: 'AI Command Centre',       category: 'core',          icon: '✨', isCore: true,  sortOrder: 5 },
  { key: 'reports',            name: 'Reports',                  category: 'core',          icon: '📊', isCore: true,  sortOrder: 6 },

  // Gatable features (can be toggled per tier)
  { key: 'product_import',           name: 'AI Product Import Pipeline', category: 'core',        icon: '📥', isCore: false, sortOrder: 7 },
  { key: 'email_integration',        name: 'Email Integration',        category: 'integrations',  icon: '📧', isCore: false, sortOrder: 10 },
  { key: 'folder_polling',           name: 'Folder Polling',           category: 'integrations',  icon: '📁', isCore: false, sortOrder: 11 },
  { key: 'shopify_integration',     name: 'Shopify Integration',      category: 'integrations',  icon: '🛍️', isCore: false, sortOrder: 12 },
  { key: 'drive_integration',        name: 'Google Drive Integration', category: 'integrations',  icon: '☁️', isCore: false, sortOrder: 13 },
  { key: 'pricing_rules',            name: 'Pricing Rules',            category: 'pricing',       icon: '💰', isCore: false, sortOrder: 20 },
  { key: 'demand_analysis',          name: 'Demand Analysis',          category: 'intelligence',  icon: '📈', isCore: false, sortOrder: 30 },
  { key: 'competitor_intelligence',  name: 'Competitor Intelligence',  category: 'intelligence',  icon: '🕵️', isCore: false, sortOrder: 31 },
  { key: 'demand_forecasting',       name: 'Demand Forecasting',       category: 'intelligence',  icon: '🔮', isCore: false, sortOrder: 32 },
  { key: 'supplier_comparison',      name: 'Supplier Comparison',      category: 'intelligence',  icon: '⚖️', isCore: false, sortOrder: 33 },
  { key: 'ai_advisor',               name: 'AI Business Advisor',      category: 'intelligence',  icon: '🤖', isCore: false, sortOrder: 34 },
];

// ── Tier definitions ─────────────────────────────────────────────────

const TIERS = [
  {
    slug: 'starter',
    name: 'Starter',
    description: 'Essential tools for small retailers — upload invoices, manage products, review & match, export, and AI insights.',
    monthlyPrice: 49,
    annualPrice: 490,
    sortOrder: 1,
    isDefault: true,
    featureKeys: [
      'invoices', 'products', 'review_match', 'export', 'ai_command_centre', 'reports',
      'product_import',
    ],
    limits: {
      max_users: 5,
      max_stores: 2,
      max_invoice_pages_per_month: 100,
      max_products: 500,
      max_pricing_rules: 5,
      max_exports_per_month: 50,
      max_email_imports_per_month: 0,
      max_folder_imports_per_month: 0,
      max_shopify_syncs_per_month: 0,
      max_competitors_monitored: 0,
      max_demand_products: 0,
      ai_queries_per_month: 50,
      max_integrations: 1,
      historical_sync_months: 12,
      analysis_window_months: 12,
    },
  },
  {
    slug: 'growth',
    name: 'Growth',
    description: 'Growing retailers — everything in Starter plus email/folder imports, pricing rules, and demand analysis.',
    monthlyPrice: 129,
    annualPrice: 1290,
    sortOrder: 2,
    isDefault: false,
    featureKeys: [
      'invoices', 'products', 'review_match', 'export', 'ai_command_centre', 'reports',
      'product_import', 'email_integration', 'folder_polling', 'shopify_integration',
      'drive_integration', 'pricing_rules', 'demand_analysis', 'ai_advisor',
    ],
    limits: {
      max_users: 15,
      max_stores: 10,
      max_invoice_pages_per_month: 500,
      max_products: 5000,
      max_pricing_rules: 20,
      max_exports_per_month: 200,
      max_email_imports_per_month: 100,
      max_folder_imports_per_month: 100,
      max_shopify_syncs_per_month: 100,
      max_competitors_monitored: 0,
      max_demand_products: 0,
      ai_queries_per_month: 200,
      max_integrations: 3,
      historical_sync_months: 24,
      analysis_window_months: 24,
    },
  },
  {
    slug: 'professional',
    name: 'Professional',
    description: 'Full platform — everything in Growth plus competitor intelligence, demand forecasting, and supplier comparison.',
    monthlyPrice: 299,
    annualPrice: 2990,
    sortOrder: 3,
    isDefault: false,
    featureKeys: [
      'invoices', 'products', 'review_match', 'export', 'ai_command_centre', 'reports',
      'product_import', 'email_integration', 'folder_polling', 'shopify_integration',
      'drive_integration', 'pricing_rules', 'demand_analysis',
      'competitor_intelligence', 'demand_forecasting', 'supplier_comparison',
      'ai_advisor',
    ],
    limits: {
      max_users: 999,
      max_stores: 999,
      max_invoice_pages_per_month: 2000,
      max_products: 20000,
      max_pricing_rules: 999,
      max_exports_per_month: 999,
      max_email_imports_per_month: 500,
      max_folder_imports_per_month: 500,
      max_shopify_syncs_per_month: 500,
      max_competitors_monitored: 50,
      max_demand_products: 100,
      ai_queries_per_month: 500,
      max_integrations: 10,
      historical_sync_months: 60,
      analysis_window_months: 60,
    },
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited everything — custom pricing, dedicated support, and full platform access.',
    monthlyPrice: 0,
    annualPrice: 0,
    sortOrder: 4,
    isDefault: false,
    featureKeys: [
      'invoices', 'products', 'review_match', 'export', 'ai_command_centre', 'reports',
      'product_import', 'email_integration', 'folder_polling', 'shopify_integration',
      'drive_integration', 'pricing_rules', 'demand_analysis',
      'competitor_intelligence', 'demand_forecasting', 'supplier_comparison',
      'ai_advisor',
    ],
    limits: {
      max_users: -1,
      max_stores: -1,
      max_invoice_pages_per_month: -1,
      max_products: -1,
      max_pricing_rules: -1,
      max_exports_per_month: -1,
      max_email_imports_per_month: -1,
      max_folder_imports_per_month: -1,
      max_shopify_syncs_per_month: -1,
      max_competitors_monitored: -1,
      max_demand_products: -1,
      ai_queries_per_month: -1,
      max_integrations: -1,
      historical_sync_months: -1,
      analysis_window_months: -1,
    },
  },
];

// ── Legacy plan → tier mapping ───────────────────────────────────────

const LEGACY_PLAN_MAP = {
  // Old legacy plan field values → new tier slugs
  starter: 'starter',
  professional: 'growth',
  enterprise: 'professional',
  // Old tier slugs → new tier slugs (for data migration)
  basic: 'starter',
  medium: 'growth',
  high: 'professional',
};

// ── Limit descriptions ───────────────────────────────────────────────

const LIMIT_DESCRIPTIONS = {
  max_users: 'Maximum team members',
  max_stores: 'Maximum stores (POS + ecommerce)',
  max_invoice_pages_per_month: 'Invoice pages processed per month (OCR)',
  max_products: 'Maximum products in catalog',
  max_pricing_rules: 'Maximum pricing rules',
  max_exports_per_month: 'Exports per month',
  max_email_imports_per_month: 'Email invoice imports per month',
  max_folder_imports_per_month: 'Folder invoice imports per month',
  max_competitors_monitored: 'Competitors monitored',
  max_demand_products: 'Products with demand analysis',
  ai_queries_per_month: 'AI queries per month (internal)',
  max_integrations: 'Maximum connected integrations',
  historical_sync_months: 'Months of historical order sync allowed',
  analysis_window_months: 'Months of sales data available for AI analysis',
};

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding features, tiers, and limits...\n');

  // 1. Upsert all features
  const featureMap = {};
  for (const f of FEATURES) {
    const feature = await prisma.feature.upsert({
      where: { key: f.key },
      create: {
        key: f.key,
        name: f.name,
        category: f.category,
        icon: f.icon,
        isCore: f.isCore,
        sortOrder: f.sortOrder,
      },
      update: {
        name: f.name,
        category: f.category,
        icon: f.icon,
        isCore: f.isCore,
        sortOrder: f.sortOrder,
      },
    });
    featureMap[f.key] = feature.id;
    console.log(`  ✅ Feature: ${f.name} (${f.key}) — ${f.isCore ? 'CORE' : 'gatable'}`);
  }

  console.log('');

  // 2. Upsert tiers with features and limits (in transaction)
  const tierMap = {};
  for (const t of TIERS) {
    const tier = await prisma.$transaction(async (tx) => {
      // Upsert the tier itself
      const tier = await tx.planTier.upsert({
        where: { slug: t.slug },
        create: {
          name: t.name,
          slug: t.slug,
          description: t.description,
          monthlyPrice: t.monthlyPrice,
          annualPrice: t.annualPrice,
          sortOrder: t.sortOrder,
          isDefault: t.isDefault,
        },
        update: {
          name: t.name,
          description: t.description,
          monthlyPrice: t.monthlyPrice,
          annualPrice: t.annualPrice,
          sortOrder: t.sortOrder,
          isDefault: t.isDefault,
        },
      });

      // Delete existing features/limits and recreate (idempotent)
      await tx.planTierFeature.deleteMany({ where: { planTierId: tier.id } });
      await tx.planTierLimit.deleteMany({ where: { planTierId: tier.id } });

      // Create tier features
      for (const fKey of t.featureKeys) {
        await tx.planTierFeature.create({
          data: {
            planTierId: tier.id,
            featureId: featureMap[fKey],
          },
        });
      }

      // Create tier limits
      for (const [limitKey, limitValue] of Object.entries(t.limits)) {
        await tx.planTierLimit.create({
          data: {
            planTierId: tier.id,
            limitKey,
            limitValue,
            description: LIMIT_DESCRIPTIONS[limitKey] || limitKey,
          },
        });
      }

      return tier;
    });

    tierMap[t.slug] = tier.id;
    console.log(`  🏷️  Tier: ${t.name} ($${t.monthlyPrice}/mo) — ${t.featureKeys.length} features, ${Object.keys(t.limits).length} limits`);
  }

  console.log('');

  // 3. Migrate existing tenants from legacy plan string to planTierId
  const tenants = await prisma.tenant.findMany({
    where: { planTierId: null },
    select: { id: true, plan: true, name: true },
  });

  if (tenants.length > 0) {
    console.log(`  🔄 Migrating ${tenants.length} tenant(s) from legacy plan field...\n`);
    for (const tenant of tenants) {
      const tierSlug = LEGACY_PLAN_MAP[tenant.plan] || 'starter';
      const tierId = tierMap[tierSlug];
      if (tierId) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { planTierId: tierId },
        });
        console.log(`    ✅ ${tenant.name}: "${tenant.plan}" → "${tierSlug}" tier`);
      }
    }
  } else {
    console.log('  ℹ️  No tenants need migration (all already have planTierId).');
  }

  console.log('\n✅ Seed complete!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
