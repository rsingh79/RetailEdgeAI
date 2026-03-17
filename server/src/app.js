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
import { startGmailScheduler } from './services/gmailScheduler.js';
import { startFolderScheduler } from './services/folderScheduler.js';
import competitorRoutes from './routes/competitor.js';
import adminOverviewRoutes from './routes/admin/overview.js';
import adminTenantRoutes from './routes/admin/tenants.js';
import adminApiUsageRoutes from './routes/admin/apiUsage.js';
import adminSettingsRoutes from './routes/admin/settings.js';

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

// Protected routes — authenticate + tenantAccess + tenantScope inject req.prisma
// Every query via req.prisma is automatically scoped to the tenant
app.use('/api/invoices', authenticate, tenantAccess, tenantScope, invoiceRoutes);
app.use('/api/products', authenticate, tenantAccess, tenantScope, productRoutes);
app.use('/api/pricing-rules', authenticate, tenantAccess, tenantScope, pricingRoutes);
app.use('/api/stores', authenticate, tenantAccess, tenantScope, storeRoutes);

// Plan-gated routes — Professional+ plans
app.use('/api/gmail', authenticate, tenantAccess, tenantScope, requirePlan('gmail_integration'), gmailRoutes);
app.use('/api/folder-polling', authenticate, tenantAccess, tenantScope, requirePlan('folder_polling'), folderRoutes);

// Plan-gated routes — Enterprise plans only
app.use('/api/competitor', authenticate, tenantAccess, tenantScope, requirePlan('competitor_intelligence'), competitorRoutes);

// Admin routes — no tenantScope, requires SYSTEM_ADMIN
const requireAdmin = [authenticate, requireRole('SYSTEM_ADMIN')];
app.use('/api/admin/overview', ...requireAdmin, adminOverviewRoutes);
app.use('/api/admin/tenants', ...requireAdmin, adminTenantRoutes);
app.use('/api/admin/api-usage', ...requireAdmin, adminApiUsageRoutes);
app.use('/api/admin/settings', ...requireAdmin, adminSettingsRoutes);

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
  app.listen(PORT, async () => {
    console.log(`RetailEdge API running on http://localhost:${PORT}`);

    // Start background polling schedulers
    try {
      const { default: prisma } = await import('./lib/prisma.js');
      startGmailScheduler(prisma);
      startFolderScheduler(prisma);
    } catch (err) {
      console.error('Failed to start schedulers:', err.message);
    }
  });
}

export default app;
