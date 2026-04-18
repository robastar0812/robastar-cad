// Stripe billing-portal session creator (Vercel Serverless Function).
// Phase 2 skeleton — lets PRO users manage their subscription.
//
// Required env vars: STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  return res.status(501).json({
    error: 'Not implemented',
    phase: 2,
    todo: [
      'Verify Supabase JWT',
      'Look up stripe_customer_id from user_plans',
      'Create billing portal session, return session.url'
    ]
  })
}
