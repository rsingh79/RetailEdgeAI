import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, requireRole } from './middleware/auth.js';
import { tenantScope } from './middleware/tenantScope.js';
import { tenantAccess } from './middleware/tenantAccess.js';
import { requirePlan } from './middleware/requirePlan.js';
import { checkApiLimit } from './middleware/apiLimiter.js';
import { standardLimiter, aiLimiter, authLimiter, webhookLimiter, importLimiter } from './middleware/rateLimits.js';
import { globalErrorHandler } from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { requestLogger } from './middleware/requestLogger.js';
import authRoutes from './routes/auth.js';
import invoiceRoutes from './routes/invoices.js';
import productRoutes from './routes/products.js';
import pricingRoutes from './routes/pricing.js';
import storeRoutes from './routes/stores.js';
import gmailRoutes from './routes/gmail.js';
import folderRoutes from './routes/folder.js';
import { handleOAuthCallback } from './services/gmail.js';
import { handleOAuthCallback as handleShopifyCallback } from './services/shopify.js';
import shopifyRoutes from './routes/shopify.js';
import analyticsRoutes from './routes/analytics.js';
import driveRoutes from './routes/drive.js';
import { handleDriveOAuthCallback } from './services/drive.js';
import { startGmailScheduler } from './services/gmailScheduler.js';
import { startFolderScheduler } from './services/folderScheduler.js';
import { startShopifySyncScheduler } from './services/shopifySyncScheduler.js';
import competitorRoutes from './routes/competitor.js';
import agentRoutes from './routes/agents.js';
import chatRoutes from './routes/chat.js';
import connectRoutes from './routes/connect.js';
import usageRoutes from './routes/usage.js';
import adminOverviewRoutes from './routes/admin/overview.js';
import adminTenantRoutes from './routes/admin/tenants.js';
import adminApiUsageRoutes from './routes/admin/apiUsage.js';
import adminSettingsRoutes from './routes/admin/settings.js';
import adminTierRoutes from './routes/admin/tiers.js';
import adminPromptRoutes from './routes/admin/prompts.js';
import metaOptimizerRoutes from './routes/admin/metaOptimizer.js';
import adminBillingRoutes from './routes/admin/billing.js';
import promptRoutes from './routes/prompts.js';
import promptChatRoutes from './routes/promptChat.js';
import suggestionRoutes from './routes/suggestions.js';
import productImportRoutes from './routes/productImport.js';
import productImportV1Routes from './routes/productImportV1.js';
import billingRoutes from './routes/billing.js';
import webhookRoutes from './routes/webhooks.js';
import healthRoutes from './routes/health.js';
import { requireActiveSubscription } from './middleware/subscriptionCheck.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Security headers — on every response (Nginx does not set these)
app.use(securityHeaders);

// Structured request logging — before routes so timing is captured
app.use(requestLogger);

// Stripe webhooks MUST be mounted before the JSON body parser
// because Stripe signature verification requires the raw request body.
app.use('/api/webhooks', webhookLimiter, webhookRoutes);

app.use(express.json({ limit: '10mb' }));

// Serve uploaded files (protected — requires auth)
app.use('/api/uploads', authenticate, express.static(path.join(__dirname, '..', 'uploads')));

// Auth routes — public (no tenant context for register/login)
// Auth rate limiter: 5 attempts/minute per IP for brute force protection
app.use('/api/auth', authLimiter, authRoutes);

// Billing routes — authenticated, tenant-scoped (checkout, cancel, portal, status)
app.use('/api/billing', authenticate, tenantAccess, tenantScope, billingRoutes);

// Gmail OAuth callback — unprotected (called by Google redirect, no JWT context)
app.get('/api/gmail/oauth/callback', async (req, res) => {
  try {
    const { code, state: tenantId, error } = req.query;
    if (error) {
      return res.redirect(`/settings?gmail=error&reason=${encodeURIComponent(error)}`);
    }
    if (!code || !tenantId) {
      return res.redirect('/settings?gmail=error&reason=missing_params');
    }
    await handleOAuthCallback(tenantId, code);
    res.redirect('/settings?gmail=connected');
  } catch (err) {
    console.error('Gmail OAuth callback error:', err);
    res.redirect(`/settings?gmail=error&reason=${encodeURIComponent(err.message)}`);
  }
});

// Shopify OAuth callback — unprotected (called by Shopify redirect, no JWT context)
app.get('/api/connect/shopify/callback', async (req, res) => {
  try {
    const { error, error_description } = req.query;
    if (error) {
      return res.redirect(`/settings?shopify=error&reason=${encodeURIComponent(error_description || error)}`);
    }
    if (!req.query.code || !req.query.shop || !req.query.state) {
      return res.redirect('/settings?shopify=error&reason=missing_params');
    }
    await handleShopifyCallback(req.query);
    res.redirect('/settings?shopify=connected');
  } catch (err) {
    console.error('Shopify OAuth callback error:', err);
    res.redirect(`/settings?shopify=error&reason=${encodeURIComponent(err.message)}`);
  }
});

// Google Drive OAuth callback — unprotected (called by Google redirect, no JWT context)
app.get('/api/drive/oauth/callback', async (req, res) => {
  try {
    const { code, state: tenantId, error } = req.query;
    if (error) {
      return res.redirect(`/settings?drive=error&reason=${encodeURIComponent(error)}`);
    }
    if (!code || !tenantId) {
      return res.redirect('/settings?drive=error&reason=missing_params');
    }
    await handleDriveOAuthCallback(tenantId, code);
    res.redirect('/settings?drive=connected');
  } catch (err) {
    console.error('Drive OAuth callback error:', err);
    res.redirect(`/settings?drive=error&reason=${encodeURIComponent(err.message)}`);
  }
});

// Protected routes — authenticate + tenantAccess + tenantScope + requireActiveSubscription
// Every query via req.prisma is automatically scoped to the tenant
const protect = [authenticate, tenantAccess, tenantScope, requireActiveSubscription];

app.use('/api/invoices', ...protect, invoiceRoutes);
app.use('/api/products', ...protect, productRoutes);
app.use('/api/product-import', ...protect, importLimiter, productImportRoutes);
app.use('/api/v1/products', ...protect, requirePlan('product_import'), importLimiter, productImportV1Routes);
app.use('/api/pricing-rules', ...protect, pricingRoutes);
app.use('/api/stores', ...protect, storeRoutes);

// AI Agents — aggregates data from existing services
app.use('/api/agents', ...protect, agentRoutes);

// POS / Ecommerce connections
app.use('/api/connect', ...protect, connectRoutes);

// Plan-gated routes — Medium+ tiers
app.use('/api/gmail', ...protect, requirePlan('email_integration'), gmailRoutes);
app.use('/api/folder-polling', ...protect, requirePlan('folder_polling'), folderRoutes);
app.use('/api/shopify', ...protect, requirePlan('shopify_integration'), shopifyRoutes);
app.use('/api/analytics', ...protect, analyticsRoutes);
app.use('/api/usage', ...protect, usageRoutes);
app.use('/api/drive', ...protect, requirePlan('drive_integration'), driveRoutes);

// Plan-gated routes — High tier only
// AI limiter on competitor (AI recommendation endpoint is expensive)
app.use('/api/competitor', ...protect, requirePlan('competitor_intelligence'), competitorRoutes);

// Business AI Advisor — chat interface (plan-gated)
// AI limiter: 10 requests/minute per tenant (replaces custom chatRateLimit for route-level gating)
app.use('/api/chat', ...protect, requirePlan('ai_advisor'), aiLimiter, chatRoutes);

// Admin routes — no tenantScope, requires SYSTEM_ADMIN
const requireAdmin = [authenticate, requireRole('SYSTEM_ADMIN')];
app.use('/api/admin/overview', ...requireAdmin, adminOverviewRoutes);
app.use('/api/admin/tenants', ...requireAdmin, adminTenantRoutes);
app.use('/api/admin/api-usage', ...requireAdmin, adminApiUsageRoutes);
app.use('/api/admin/settings', ...requireAdmin, adminSettingsRoutes);
app.use('/api/admin/tiers', ...requireAdmin, adminTierRoutes);
app.use('/api/admin/prompts', ...requireAdmin, adminPromptRoutes);
app.use('/api/admin/meta-optimizer', ...requireAdmin, metaOptimizerRoutes);
app.use('/api/admin', ...requireAdmin, adminBillingRoutes);

// Prompt management — available to all tenants
app.use('/api/prompts', ...protect, promptRoutes);
app.use('/api/prompt-chat', ...protect, promptChatRoutes);
app.use('/api/suggestions', ...protect, suggestionRoutes);

// Health check — public, no auth, no rate limit
app.use('/health', healthRoutes);
// Backward compatibility: keep /api/health pointing to the same handler
app.use('/api/health', healthRoutes);

// Standard API rate limiter — catch-all for any /api route not already covered
// by a more specific limiter above. Must be AFTER all specific route mounts.
app.use('/api', standardLimiter);

// Global error handler — MUST be the last middleware.
// Returns standardised { error, code, message } format. Never leaks stack traces.
app.use(globalErrorHandler);

// Only listen when run directly (not when imported by tests)
const isMainModule = process.argv[1] && !process.argv[1].includes('vitest');
if (isMainModule) {
  // Start the interaction signal collector (async buffer flush)
  import('./services/signalCollector.js')
    .then(({ startSignalCollector }) => startSignalCollector())
    .catch((err) => console.warn('Signal collector failed to start:', err.message));

  // Start conversation abandonment detector (runs every 30 min)
  import('./services/conversationCleanup.js')
    .then(({ startConversationCleanup }) => startConversationCleanup())
    .catch((err) => console.warn('Conversation cleanup failed to start:', err.message));

  app.listen(PORT, async () => {
    console.log(`RetailEdge API running on http://localhost:${PORT}`);

    // Polling is triggered on-demand via the UI ("Poll Now") or API endpoints.
    // Background schedulers are disabled — customer's pollIntervalMin controls
    // frequency when they choose to enable scheduled polling.
    // try {
    //   const { default: prisma } = await import('./lib/prisma.js');
    //   startGmailScheduler(prisma);
    //   startFolderScheduler(prisma);
    // } catch (err) {
    //   console.error('Failed to start schedulers:', err.message);
    // }

    // Shopify daily auto-sync — runs at 02:00 UTC for opted-in tenants
    try {
      startShopifySyncScheduler();
    } catch (err) {
      console.error('Failed to start Shopify sync scheduler:', err.message);
    }
  });
}

export default app;
