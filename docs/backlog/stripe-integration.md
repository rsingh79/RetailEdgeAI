# Stripe Integration — Payment Management

## Overview
Integrate Stripe Billing to manage subscription lifecycle, payment collection, and invoicing for RetailEdge tenants. Replaces the current manual subscription management with automated billing.

## Scope

### Tenant Onboarding
- Create a Stripe Customer when a new tenant registers
- Store `stripeCustomerId` on the Tenant model
- Link owner's email as the Stripe customer email

### Subscription Management
- Create Stripe Subscriptions for each tenant based on their plan (starter, professional, enterprise)
- Handle plan upgrades/downgrades via Stripe proration
- Store `stripeSubscriptionId` on the Tenant model
- Auto-transition from trial to paid when trial ends (if payment method on file)

### Payment Methods
- Embed Stripe Elements on the tenant Settings page for adding/updating payment methods
- Use Stripe SetupIntents for securely collecting card details
- Update `paymentMethodOnFile` flag when payment method is added/removed

### Webhook Handling
- `POST /api/webhooks/stripe` endpoint (no auth — verified by Stripe signature)
- Handle events: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Auto-lock tenant on repeated payment failures
- Update `subscriptionStatus` based on Stripe subscription state

### Admin Portal Integration
- Show Stripe subscription details in admin tenant detail view
- Link to Stripe Customer Portal for manual management
- Display Stripe invoice history in the Subscription tab

## Data Model Changes
```prisma
model Tenant {
  // ... existing fields ...
  stripeCustomerId      String?  @unique
  stripeSubscriptionId  String?  @unique
}
```

## API Changes
- `POST /api/billing/create-setup-intent` — Create a Stripe SetupIntent for adding payment methods
- `POST /api/billing/portal-session` — Create a Stripe Customer Portal session URL
- `POST /api/webhooks/stripe` — Stripe webhook receiver (raw body, signature verification)

## Frontend Changes
- Add Stripe Elements (via `@stripe/react-stripe-js`) to Settings page
- Add "Manage Billing" button that redirects to Stripe Customer Portal
- Show payment status and next invoice date in tenant dashboard

## Dependencies
- `stripe` — Stripe Node.js SDK
- `@stripe/react-stripe-js` + `@stripe/stripe-js` — Frontend Stripe Elements
- Environment variables: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`

## Pricing Configuration
Plans to configure in Stripe Dashboard:
- **Starter**: $29/month — 5 users, 2 stores, 100 API calls/month
- **Professional**: $79/month — 15 users, 10 stores, 500 API calls/month
- **Enterprise**: $199/month — Unlimited users/stores, 2000 API calls/month
