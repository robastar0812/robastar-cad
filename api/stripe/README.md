# Stripe Integration — Phase 2 Skeleton

These Vercel Serverless Functions are **not yet implemented**. Phase 1 ships
Supabase auth only; billing is scheduled for a later pass.

## Files

| File | Purpose |
| ---- | ------- |
| `create-checkout.js` | Creates a Stripe Checkout session for PRO upgrade (¥500/mo) |
| `webhook.js` | Syncs subscription events → `user_plans.plan` |
| `portal.js` | Opens Stripe Customer Portal for plan management |

## Required environment variables (Vercel dashboard)

```
STRIPE_SECRET_KEY       # sk_live_... or sk_test_...
STRIPE_WEBHOOK_SECRET   # whsec_... (from Stripe CLI or dashboard)
STRIPE_PRICE_ID         # price_... (create the Price in Stripe dashboard)
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL
```

## Webhook endpoint to register in Stripe dashboard

```
https://<your-domain>.vercel.app/api/stripe/webhook
```

Events to subscribe to:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
