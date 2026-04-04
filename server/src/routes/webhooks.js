import { Router } from 'express';
import express from 'express';
import stripe from '../services/stripe.js';
import { adminPrisma } from '../lib/prisma.js';
import { mapPriceToTier, BILLING_DEFAULTS } from '../config/tierLimits.js';
import { resetUsage, updateLimitsForTierChange } from '../services/usageTracker.js';

const router = Router();

// ── Helpers ────────────────────────────────────────────────────

async function getTenantByStripeCustomer(stripeCustomerId) {
  const tenant = await adminPrisma.tenant.findUnique({
    where: { stripeCustomerId },
    select: { id: true, gracePeriodDays: true },
  });
  if (!tenant) throw new Error(`No tenant found for Stripe customer ${stripeCustomerId}`);
  return tenant;
}

async function updateTenantTier(tenantId, tierSlug) {
  const planTier = await adminPrisma.planTier.findUnique({
    where: { slug: tierSlug },
    include: { limits: true },
  });

  if (!planTier) {
    console.warn(`Tier not found for slug: ${tierSlug}`);
    return;
  }

  // Sync legacy limit columns from tier
  const limitMap = {};
  for (const l of planTier.limits) {
    limitMap[l.limitKey] = l.limitValue;
  }

  await adminPrisma.tenant.update({
    where: { id: tenantId },
    data: {
      planTierId: planTier.id,
      plan: tierSlug,
      ...(limitMap.max_users && { maxUsers: limitMap.max_users }),
      ...(limitMap.max_stores && { maxStores: limitMap.max_stores }),
      ...(limitMap.max_invoice_pages_per_month && { maxApiCallsPerMonth: limitMap.max_invoice_pages_per_month }),
    },
  });

  // Update current billing period's usage limits
  await updateLimitsForTierChange(null, tenantId, tierSlug);
}

async function getSystemGracePeriodDays() {
  try {
    const settings = await adminPrisma.platformSettings.findUnique({
      where: { id: 'singleton' },
      select: { gracePeriodDays: true },
    });
    return settings?.gracePeriodDays ?? BILLING_DEFAULTS.defaultGracePeriodDays;
  } catch {
    return BILLING_DEFAULTS.defaultGracePeriodDays;
  }
}

// ── Webhook handlers ───────────────────────────────────────────

async function handleCheckoutCompleted(session) {
  const tenantId = session.metadata?.tenantId;
  if (!tenantId) {
    console.warn('checkout.session.completed: no tenantId in metadata');
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  const priceId = subscription.items.data[0].price.id;
  const tierSlug = mapPriceToTier(priceId);

  await adminPrisma.tenant.update({
    where: { id: tenantId },
    data: {
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      subscriptionStatus: 'active',
      hasTrialExpired: false,
      billingPeriodStart: new Date(subscription.current_period_start * 1000),
      billingPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
  });

  await updateTenantTier(tenantId, tierSlug);

  // Reset usage for the new subscription billing period
  await resetUsage(
    null,
    tenantId,
    new Date(subscription.current_period_start * 1000),
    new Date(subscription.current_period_end * 1000)
  );

  console.log(`checkout.session.completed: tenant ${tenantId} → ${tierSlug} (active)`);
}

async function handlePaymentSucceeded(invoice) {
  if (invoice.billing_reason !== 'subscription_cycle') return;

  const tenant = await getTenantByStripeCustomer(invoice.customer);

  await adminPrisma.tenant.update({
    where: { id: tenant.id },
    data: {
      subscriptionStatus: 'active',
      billingPeriodStart: new Date(invoice.period_start * 1000),
      billingPeriodEnd: new Date(invoice.period_end * 1000),
      gracePeriodEndsAt: null, // clear any grace period on successful payment
    },
  });

  // Reset usage counters for the new billing period
  await resetUsage(
    null,
    tenant.id,
    new Date(invoice.period_start * 1000),
    new Date(invoice.period_end * 1000)
  );

  console.log(`invoice.payment_succeeded: tenant ${tenant.id} — new billing period started`);
}

async function handlePaymentFailed(invoice) {
  const tenant = await getTenantByStripeCustomer(invoice.customer);

  // Use per-tenant override if set, otherwise system default
  const systemGrace = await getSystemGracePeriodDays();
  const graceDays = tenant.gracePeriodDays ?? systemGrace;
  const gracePeriodEndsAt = new Date();
  gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + graceDays);

  await adminPrisma.tenant.update({
    where: { id: tenant.id },
    data: {
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt,
    },
  });

  console.warn(`invoice.payment_failed: tenant ${tenant.id}. Grace period: ${graceDays} days, ends ${gracePeriodEndsAt.toISOString()}`);
}

async function handleSubscriptionUpdated(subscription) {
  const tenantId = subscription.metadata?.tenantId;
  if (!tenantId) {
    console.warn('customer.subscription.updated: no tenantId in metadata');
    return;
  }

  const newPriceId = subscription.items.data[0].price.id;
  const tierSlug = mapPriceToTier(newPriceId);

  await adminPrisma.tenant.update({
    where: { id: tenantId },
    data: {
      stripePriceId: newPriceId,
      subscriptionStatus: subscription.cancel_at_period_end ? 'cancelled' : 'active',
      billingPeriodStart: new Date(subscription.current_period_start * 1000),
      billingPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
  });

  // Update limits immediately (upgrades take effect now)
  if (!subscription.cancel_at_period_end) {
    await updateTenantTier(tenantId, tierSlug);
  }

  console.log(`customer.subscription.updated: tenant ${tenantId} → ${tierSlug}`);
}

async function handleSubscriptionDeleted(subscription) {
  const tenantId = subscription.metadata?.tenantId;
  if (!tenantId) {
    console.warn('customer.subscription.deleted: no tenantId in metadata');
    return;
  }

  await adminPrisma.tenant.update({
    where: { id: tenantId },
    data: {
      subscriptionStatus: 'suspended',
      stripeSubscriptionId: null,
    },
  });

  console.warn(`customer.subscription.deleted: tenant ${tenantId}. 30-day retention period started.`);
}

// ── Webhook endpoint ───────────────────────────────────────────
// CRITICAL: Must use express.raw() for Stripe signature verification.
// Must NOT have authenticate or tenantScope middleware.

router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object);
          break;
        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object);
          break;
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object);
          break;
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object);
          break;
        default:
          // Unhandled event types — log and acknowledge
          break;
      }
    } catch (err) {
      // Log but still return 200 so Stripe doesn't retry
      console.error(`Webhook handler error for ${event.type}:`, err);
    }

    res.json({ received: true });
  }
);

export default router;
