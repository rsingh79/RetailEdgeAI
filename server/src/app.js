import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, requireRole } from './middleware/auth.js';
import { tenantScope } from './middleware/tenantScope.js';
import { tenantAccess } from './middleware/tenantAccess.js';
import { requirePlan } from './middleware/requirePlan.js';
import { checkApiLimit } from './middleware/apiLimiter.js';
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
import driveRoutes from './routes/drive.js';
import { handleDriveOAuthCallback } from './services/drive.js';
import { startGmailScheduler } from './services/gmailScheduler.js';
import { startFolderScheduler } from './services/folderScheduler.js';
import competitorRoutes from './routes/competitor.js';
import agentRoutes from './routes/agents.js';
import chatRoutes from './routes/chat.js';
import connectRoutes from './routes/connect.js';
import adminOverviewRoutes from './routes/admin/overview.js';
import adminTenantRoutes from './routes/admin/tenants.js';
import adminApiUsageRoutes from './routes/admin/apiUsage.js';
import adminSettingsRoutes from './routes/admin/settings.js';
import adminTierRoutes from './routes/admin/tiers.js';
import adminPromptRoutes from './routes/admin/prompts.js';
import metaOptimizerRoutes from './routes/admin/metaOptimizer.js';
import promptRoutes from './routes/prompts.js';
import promptChatRoutes from './routes/promptChat.js';
import suggestionRoutes from './routes/suggestions.js';
import productImportRoutes from './routes/productImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve uploaded files (protected — requires auth)
app.use('/api/uploads', authenticate, express.static(path.join(__dirname, '..', 'uploads')));

// Auth routes — public (no tenant context for register/login)
app.use('/api/auth', authRoutes);

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

// Protected routes — authenticate + tenantAccess + tenantScope inject req.prisma
// Every query via req.prisma is automatically scoped to the tenant
app.use('/api/invoices', authenticate, tenantAccess, tenantScope, invoiceRoutes);
app.use('/api/products', authenticate, tenantAccess, tenantScope, productRoutes);
app.use('/api/product-import', authenticate, tenantAccess, tenantScope, productImportRoutes);
app.use('/api/pricing-rules', authenticate, tenantAccess, tenantScope, pricingRoutes);
app.use('/api/stores', authenticate, tenantAccess, tenantScope, storeRoutes);

// AI Agents — aggregates data from existing services
app.use('/api/agents', authenticate, tenantAccess, tenantScope, agentRoutes);

// POS / Ecommerce connections
app.use('/api/connect', authenticate, tenantAccess, tenantScope, connectRoutes);

// Plan-gated routes — Medium+ tiers
app.use('/api/gmail', authenticate, tenantAccess, tenantScope, requirePlan('email_integration'), gmailRoutes);
app.use('/api/folder-polling', authenticate, tenantAccess, tenantScope, requirePlan('folder_polling'), folderRoutes);
app.use('/api/shopify', authenticate, tenantAccess, tenantScope, requirePlan('shopify_integration'), shopifyRoutes);
app.use('/api/drive', authenticate, tenantAccess, tenantScope, requirePlan('drive_integration'), driveRoutes);

// Plan-gated routes — High tier only
app.use('/api/competitor', authenticate, tenantAccess, tenantScope, requirePlan('competitor_intelligence'), competitorRoutes);

// Business AI Advisor — chat interface (plan-gated)
app.use('/api/chat', authenticate, tenantAccess, tenantScope, requirePlan('ai_advisor'), chatRoutes);

// Admin routes — no tenantScope, requires SYSTEM_ADMIN
const requireAdmin = [authenticate, requireRole('SYSTEM_ADMIN')];
app.use('/api/admin/overview', ...requireAdmin, adminOverviewRoutes);
app.use('/api/admin/tenants', ...requireAdmin, adminTenantRoutes);
app.use('/api/admin/api-usage', ...requireAdmin, adminApiUsageRoutes);
app.use('/api/admin/settings', ...requireAdmin, adminSettingsRoutes);
app.use('/api/admin/tiers', ...requireAdmin, adminTierRoutes);
app.use('/api/admin/prompts', ...requireAdmin, adminPromptRoutes);
app.use('/api/admin/meta-optimizer', ...requireAdmin, metaOptimizerRoutes);

// Prompt management — available to all tenants
app.use('/api/prompts', authenticate, tenantAccess, tenantScope, promptRoutes);
app.use('/api/prompt-chat', authenticate, tenantAccess, tenantScope, promptChatRoutes);
app.use('/api/suggestions', authenticate, tenantAccess, tenantScope, suggestionRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'retailedge-api' });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

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
  });
}

export default app;
