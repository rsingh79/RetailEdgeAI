import { Router } from 'express';
import stripe from '../services/stripe.js';
import { adminPrisma } from '../lib/prisma.js';
import { getPriceRank, mapPriceToTier } from '../config/tierLimits.js';
import { updateLimitsForTierChange } from '../services/usageTracker.js';

const router = Router();

// ── Helpers ────────────────────────────────────────────────────

const VALID_PRICE_IDS = new Set(
  [process.env.STRIPE_PRICE_STARTER, process.env.STRIPE_PRICE_GROWTH, process.env.STRIPE_PRICE_PRO].filter(Boolean)
);

function requireStripe(_req, res, next) {
  if (!stripe) {
    return res.status(503).json({ error: 'Billing service unavailable', code: 'STRIPE_NOT_CONFIGURED' });
  }
  next();
}

async function getTenant(req) {
  return adminPrisma.tenant.findUnique({
    where: { id: req.tenantId },
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      subscriptionStatus: true,
      billingPeriodStart: true,
      billingPeriodEnd: true,
      trialEndsAt: true,
      gracePeriodDays: true,
      gracePeriodEndsAt: true,
      planTier: { select: { slug: true, name: true, monthlyPrice: true } },
    },
  });
}

// ── POST /api/billing/create-checkout ──────────────────────────

router.post('/create-checkout', requireStripe, async (req, res) => {
  try {
    const { priceId } = req.body;

    if (!priceId || !VALID_PRICE_IDS.has(priceId)) {
      return res.status(400).json({ error: 'Invalid priceId' });
    }

    const tenant = await getTenant(req);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Deferred Stripe customer creation (trial tenants don't have one yet)
    let stripeCustomerId = tenant.stripeCustomerId;
    if (!stripeCustomerId) {
      const user = await adminPrisma.user.findUnique({
        where: { id: req.user.userId },
        select: { email: true },
      });

      const stripeCustomer = await stripe.customers.create({
        email: user.email,
        name: tenant.name,
        metadata: { tenantId: tenant.id, environment: process.env.NODE_ENV || 'development' },
      });

      await adminPrisma.tenant.update({
        where: { id: tenant.id },
        data: { stripeCustomerId: stripeCustomer.id },
      });

      stripeCustomerId = stripeCustomer.id;
    }

    const appUrl = process.env.APP_URL || 'http://localhost:5174';
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/settings/billing?success=true`,
      cancel_url: `${appUrl}/settings/billing?cancelled=true`,
      metadata: { tenantId: tenant.id },
      subscription_data: { metadata: { tenantId: tenant.id } },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('create-checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/billing/change-plan ──────────────────────────────

router.post('/change-plan', requireStripe, async (req, res) => {
  try {
    const { newPriceId } = req.body;

    if (!newPriceId || !VALID_PRICE_IDS.has(newPriceId)) {
      return res.status(400).json({ error: 'Invalid newPriceId' });
    }

    const tenant = await getTenant(req);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    if (!tenant.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription to change' });
    }

    const currentPriceId = tenant.stripePriceId;
    const isUpgrade = getPriceRank(newPriceId) > getPriceRank(currentPriceId);

    const subscription = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);

    await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
      items: [{ id: subscription.items.data[0].id, price: newPriceId }],
      proration_behavior: isUpgrade ? 'create_prorations' : 'none',
    });

    // For upgrades, update limits immediately
    if (isUpgrade) {
      const tierSlug = mapPriceToTier(newPriceId);
      const planTier = await adminPrisma.planTier.findUnique({ where: { slug: tierSlug } });

      await adminPrisma.tenant.update({
        where: { id: tenant.id },
        data: {
          stripePriceId: newPriceId,
          planTierId: planTier?.id,
          plan: tierSlug,
        },
      });

      await updateLimitsForTierChange(null, tenant.id, tierSlug);
    }

    // Log plan change
    await adminPrisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: 'PLAN_CHANGED',
        details: JSON.stringify({
          from: currentPriceId,
          to: newPriceId,
          direction: isUpgrade ? 'upgrade' : 'downgrade',
          changedBy: req.user.userId,
        }),
        performedBy: req.user.userId,
      },
    });

    res.json({
      success: true,
      effective: isUpgrade ? 'immediately' : 'next_period',
      direction: isUpgrade ? 'upgrade' : 'downgrade',
    });
  } catch (err) {
    console.error('change-plan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/billing/cancel ───────────────────────────────────

router.post('/cancel', requireStripe, async (req, res) => {
  try {
    const { mode, reason, reasonDetail } = req.body;

    if (!mode || !['end_of_period', 'immediate'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "end_of_period" or "immediate"' });
    }

    const tenant = await getTenant(req);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    if (!tenant.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription to cancel' });
    }

    if (mode === 'end_of_period') {
      // ── Mode 1: Cancel at period end (no refund) ──
      await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      await adminPrisma.tenant.update({
        where: { id: tenant.id },
        data: { subscriptionStatus: 'cancelled' },
      });

      await adminPrisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          action: 'SUBSCRIPTION_CANCELLED',
          details: JSON.stringify({
            mode: 'end_of_period',
            reason: reason || null,
            reasonDetail: reasonDetail || null,
            accessUntil: tenant.billingPeriodEnd,
            cancelledBy: req.user.userId,
          }),
          performedBy: req.user.userId,
        },
      });

      return res.json({
        success: true,
        mode: 'end_of_period',
        accessUntil: tenant.billingPeriodEnd,
        message: 'Your subscription has been cancelled. You have full access until the end of your current billing period.',
      });
    }

    // ── Mode 2: Cancel immediately with pro-rata refund ──
    await stripe.subscriptions.cancel(tenant.stripeSubscriptionId, { prorate: true });

    // Calculate pro-rata refund
    const now = new Date();
    let refundAmount = 0;
    let remainingDays = 0;

    if (tenant.billingPeriodStart && tenant.billingPeriodEnd) {
      const periodStart = new Date(tenant.billingPeriodStart);
      const periodEnd = new Date(tenant.billingPeriodEnd);
      const totalDays = Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24));
      const usedDays = Math.ceil((now - periodStart) / (1000 * 60 * 60 * 24));
      remainingDays = Math.max(0, totalDays - usedDays);

      const monthlyPrice = tenant.planTier?.monthlyPrice || 0;
      const dailyRate = monthlyPrice / totalDays;
      refundAmount = Math.round(dailyRate * remainingDays * 100); // in cents
    }

    // Issue refund if applicable
    if (refundAmount > 0) {
      try {
        const invoices = await stripe.invoices.list({
          customer: tenant.stripeCustomerId,
          subscription: tenant.stripeSubscriptionId,
          status: 'paid',
          limit: 1,
        });

        if (invoices.data.length > 0 && invoices.data[0].payment_intent) {
          await stripe.refunds.create({
            payment_intent: invoices.data[0].payment_intent,
            amount: refundAmount,
            reason: 'requested_by_customer',
          });
        }
      } catch (refundErr) {
        console.error('Refund failed (non-blocking):', refundErr.message);
      }
    }

    await adminPrisma.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: 'cancelled',
        billingPeriodEnd: now,
      },
    });

    await adminPrisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: 'SUBSCRIPTION_CANCELLED',
        details: JSON.stringify({
          mode: 'immediate',
          reason: reason || null,
          reasonDetail: reasonDetail || null,
          refundAmount: refundAmount / 100,
          refundDays: remainingDays,
          cancelledBy: req.user.userId,
        }),
        performedBy: req.user.userId,
      },
    });

    return res.json({
      success: true,
      mode: 'immediate',
      refundAmount: (refundAmount / 100).toFixed(2),
      refundDays: remainingDays,
      message: `Your subscription has been cancelled. A refund of $${(refundAmount / 100).toFixed(2)} AUD for the remaining ${remainingDays} days has been processed.`,
    });
  } catch (err) {
    console.error('cancel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/billing/portal ───────────────────────────────────

router.post('/portal', requireStripe, async (req, res) => {
  try {
    const tenant = await getTenant(req);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    if (!tenant.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account. Please select a plan first.' });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:5174';
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${appUrl}/settings/billing`,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('portal error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/billing/status ────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const tenant = await getTenant(req);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Calculate trial days remaining
    let trialDaysRemaining = null;
    if (tenant.subscriptionStatus === 'trialing' || tenant.subscriptionStatus === 'trial') {
      if (tenant.trialEndsAt) {
        const msRemaining = new Date(tenant.trialEndsAt) - new Date();
        trialDaysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
      }
    }

    res.json({
      tier: tenant.planTier?.slug || null,
      tierName: tenant.planTier?.name || null,
      monthlyPrice: tenant.planTier?.monthlyPrice || null,
      status: tenant.subscriptionStatus,
      stripeCustomerId: tenant.stripeCustomerId || null,
      stripePriceId: tenant.stripePriceId || null,
      currentPeriodStart: tenant.billingPeriodStart,
      currentPeriodEnd: tenant.billingPeriodEnd,
      trialEndsAt: tenant.trialEndsAt,
      trialDaysRemaining,
      gracePeriodEndsAt: tenant.gracePeriodEndsAt,
      hasStripeSubscription: !!tenant.stripeSubscriptionId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
