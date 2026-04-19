// Vercel Cron Job: Supabase keep-alive ping
// ───────────────────────────────────────────
// Supabase free-tier projects auto-pause after ~7 days of inactivity.
// Vercel's cron (configured in vercel.json) hits this endpoint weekly
// to issue a trivial SELECT against user_plans, resetting the idle timer.
//
// Required env vars (Vercel dashboard):
//   VITE_SUPABASE_URL              (reused from the public client)
//   SUPABASE_SERVICE_ROLE_KEY      (service role — never exposed to browser)
//   CRON_SECRET                    (Vercel auto-injects Bearer token)

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // Vercel Cron requests carry `Authorization: Bearer <CRON_SECRET>`.
  // Reject anything else so the endpoint isn't a public probe target.
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || req.headers.authorization !== expected) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'missing supabase env vars' })
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false }
  })

  // HEAD-style count query — lightest possible touch that counts as activity.
  const { error, count } = await supabase
    .from('user_plans')
    .select('*', { count: 'exact', head: true })

  if (error) {
    console.error('[cron/keep-alive]', error)
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({
    ok: true,
    count: count ?? 0,
    timestamp: new Date().toISOString()
  })
}
