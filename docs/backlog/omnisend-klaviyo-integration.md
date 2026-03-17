# Omnisend / Klaviyo Integration — Email Marketing

## Overview
Integrate with Omnisend or Klaviyo to send automated transactional and lifecycle emails to tenants. Handles trial notifications, welcome emails, account alerts, and marketing communications.

## Scope

### Automated Email Triggers

| Trigger | Timing | Email Content |
|---------|--------|---------------|
| Welcome | On tenant registration | Welcome message, getting started guide, support links |
| Trial Expiring | 3 days before trial end | Reminder to add payment method, plan comparison |
| Trial Expired | On trial expiry | Account locked notice, upgrade CTA |
| Payment Failed | On Stripe payment failure | Update payment method prompt |
| Invoice Processed | After invoice approval | Summary of price changes applied |
| Account Locked | When admin locks tenant | Reason and support contact |
| Account Unlocked | When admin unlocks tenant | Access restored confirmation |

### Contact Sync
- Sync tenant owner details to Omnisend/Klaviyo as contacts
- Include custom properties: plan, subscriptionStatus, trialEndsAt, tenantName
- Update contact properties on subscription changes
- Tag contacts by plan tier and lifecycle stage

### Event Tracking
- Track key tenant actions as custom events:
  - `invoice_uploaded` — tenant uploaded an invoice
  - `invoice_approved` — invoice pricing approved
  - `subscription_upgraded` — plan upgrade
  - `subscription_cancelled` — plan cancellation
- Use events to trigger automated email flows in Omnisend/Klaviyo

## Architecture

### Event Emitter Pattern
Create a `server/src/services/platformEvents.js` event emitter:
```javascript
import { EventEmitter } from 'events';
export const platformEvents = new EventEmitter();

// Emit from business logic:
platformEvents.emit('tenant.registered', { tenantId, ownerEmail, plan });
platformEvents.emit('trial.expiring', { tenantId, daysRemaining: 3 });
```

### Email Service Adapter
Create `server/src/services/emailService.js` with adapter pattern:
```javascript
// Supports both Omnisend and Klaviyo via adapter
export async function sendTransactionalEmail(templateId, recipientEmail, data) { ... }
export async function syncContact(email, properties) { ... }
export async function trackEvent(email, eventName, properties) { ... }
```

## Data Model Changes
```prisma
model PlatformSettings {
  // ... existing fields ...
  emailProvider        String?  // "omnisend" | "klaviyo" | null
  emailApiKey          String?  // encrypted API key
  emailFromName        String?  @default("RetailEdge")
  emailFromEmail       String?  @default("noreply@retailedge.com")
}
```

## API Changes
- `PATCH /api/admin/settings` — Add email provider configuration fields
- No new public endpoints — emails triggered internally via events

## Dependencies (choose one)
- **Omnisend**: `@omnisend/node-sdk` — transactional emails + contact sync
- **Klaviyo**: `klaviyo-api` — email flows + contact profiles + event tracking

## Configuration
- Email provider API key stored in PlatformSettings (encrypted at rest)
- Email templates created in Omnisend/Klaviyo dashboard
- Template IDs mapped in `server/src/config/emailTemplates.js`

## Scheduled Jobs
- Daily cron to check for expiring trials (3 days out) and emit `trial.expiring` events
- Can use the existing PlatformSettings `autoLockOnTrialExpiry` to auto-lock + notify
