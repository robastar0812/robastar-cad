// Stripe Checkout session creator (Vercel Serverless Function).
// Phase 2 skeleton — fill in before enabling PRO plan purchases.
//
// Required env vars (set in Vercel dashboard):
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID, SUPABASE_SERVICE_ROLE_KEY
//
// Expected request body: { userId: string }
// Returns: { url: string }  (Stripe hosted-checkout URL)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  return res.status(501).json({
    error: 'Not implemented',
    phase: 2,
    todo: [
      'Initialize Stripe client with STRIPE_SECRET_KEY',
      'Verify Supabase JWT from Authorization header',
      'Create or fetch Stripe customer for user',
      'Create checkout session with STRIPE_PRICE_ID',
      'Persist stripe_customer_id to user_plans row'
    ]
  })
}
