import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { adminPrisma as prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { TIER_LIMITS, BILLING_DEFAULTS } from '../config/tierLimits.js';

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, tenantName } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    // Find the Growth tier for trial (generous limits to demo the product)
    const trialTierSlug = BILLING_DEFAULTS.trialTier;
    const trialDays = BILLING_DEFAULTS.trialDays;
    const trialLimits = TIER_LIMITS[trialTierSlug] || TIER_LIMITS.growth;

    const growthTier = await prisma.planTier.findUnique({ where: { slug: trialTierSlug } });
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    const tenant = await prisma.tenant.create({
      data: {
        name: tenantName || 'My Business',
        planTierId: growthTier?.id || null,
        plan: trialTierSlug,
        subscriptionStatus: 'trialing',
        trialStartedAt: new Date(),
        trialEndsAt,
        trialTier: trialTierSlug,
        // No stripeCustomerId — deferred until plan selection
      },
    });

    // Create TenantUsage with Growth-tier limits for the trial period
    await prisma.tenantUsage.create({
      data: {
        tenantId: tenant.id,
        billingPeriodStart: new Date(),
        billingPeriodEnd: trialEndsAt,
        aiQueriesLimit: trialLimits.aiQueries,
        productsLimit: trialLimits.products,
        integrationsLimit: trialLimits.integrations,
        historicalSyncMonths: trialLimits.historicalSyncMonths,
      },
    });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role: 'OWNER', tenantId: tenant.id },
    });

    const token = jwt.sign(
      { userId: user.id, tenantId: tenant.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { userId: user.id, tenantId: user.tenantId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true, email: true, name: true, role: true, tenantId: true,
        tenant: {
          select: {
            plan: true,
            name: true,
            maxUsers: true,
            maxStores: true,
            maxApiCallsPerMonth: true,
            subscriptionStatus: true,
            trialEndsAt: true,
            trialStartedAt: true,
            stripeCustomerId: true,
            billingPeriodEnd: true,
            planTierId: true,
            planTier: {
              select: {
                id: true,
                name: true,
                slug: true,
                monthlyPrice: true,
                features: {
                  select: {
                    feature: {
                      select: { key: true, name: true, isCore: true },
                    },
                  },
                },
                limits: {
                  select: { limitKey: true, limitValue: true, description: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Build flat enabledFeatures array and limits object for client convenience
    const enabledFeatures = user.tenant?.planTier?.features.map((f) => f.feature.key) || [];
    const limits = {};
    if (user.tenant?.planTier?.limits) {
      for (const l of user.tenant.planTier.limits) {
        limits[l.limitKey] = l.limitValue;
      }
    }

    // Calculate trial days remaining
    let trialDaysRemaining = null;
    const status = user.tenant?.subscriptionStatus;
    if ((status === 'trialing' || status === 'trial') && user.tenant?.trialEndsAt) {
      const msRemaining = new Date(user.tenant.trialEndsAt) - new Date();
      trialDaysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    }

    res.json({
      ...user,
      enabledFeatures,
      limits,
      tierName: user.tenant?.planTier?.name || null,
      tierSlug: user.tenant?.planTier?.slug || user.tenant?.plan || null,
      trialDaysRemaining,
      hasStripeCustomer: !!user.tenant?.stripeCustomerId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
