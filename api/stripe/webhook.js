// Stripe webhook handler (Vercel Serverless Function).
// Phase 2 skeleton — wires subscription events to user_plans.plan.
//
// Required env vars:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY
//
// Handles: customer.subscription.{created,updated,deleted}, invoice.paid

export const config = {
  api: { bodyParser: false }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed')
  }

  return res.status(501).json({
    error: 'Not implemented',
    phase: 2,
    todo: [
      'Read raw body via readable stream (bodyParser: false)',
      'Verify signature against STRIPE_WEBHOOK_SECRET',
      'Switch on event.type and update user_plans.plan via service-role client',
      'Return 200 quickly; do not retry DB work inside the handler'
    ]
  })
}
