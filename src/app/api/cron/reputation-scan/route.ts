import { supabaseAdmin } from '@/lib/supabase'
import { cronHandler, forEachClient, callAgent, selfBaseUrl, SkipCounter } from '@/lib/cron'

// GET /api/cron/reputation-scan — hourly through US business hours.
//
// Fans out to /api/agents/reputation/analyze once per active client. That
// route finds reviews with responded = false and drafts a reply for each.
//
// Hourly rather than every few minutes: a bad review matters same-day, not
// same-minute, and every extra run is an AI call per client to learn nothing.

export const runtime = 'nodejs'
export const maxDuration = 120

export const GET = cronHandler({
  name: 'reputation-scan',
  agentType: 'reputation_intelligence',
  async run() {
    const base = selfBaseUrl()
    if (!base) {
      throw new Error('Cannot resolve own URL: set NEXT_PUBLIC_APP_URL (VERCEL_URL is also accepted).')
    }

    const { data: clients, error } = await supabaseAdmin
      .from('clients')
      .select('id, name')
      .eq('status', 'active')

    if (error) throw new Error(`clients query failed: ${error.message}`)

    const list = clients ?? []
    const skipped = new SkipCounter()
    let reviewsPending = 0
    let reviewsDrafted = 0

    const { errors, results } = await forEachClient(list, async (client) => {
      const out = await callAgent(base, '/api/agents/reputation/analyze', { client_id: client.id })

      const pending = Number(out?.pending) || 0
      const drafted = Number(out?.drafted) || 0
      reviewsPending += pending
      reviewsDrafted += drafted

      if (pending === 0) skipped.add('no_unanswered_reviews')
      else if (drafted < pending) skipped.add('draft_failed', pending - drafted)

      return { pending, drafted }
    })

    return {
      scanned: list.length,
      acted: results.filter((r) => r.status === 'ok' && Number(r.drafted) > 0).length,
      skipped: skipped.toJSON(),
      errors,
      detail: { reviews_pending: reviewsPending, reviews_drafted: reviewsDrafted, clients: results },
    }
  },
})
