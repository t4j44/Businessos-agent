import { supabaseAdmin } from '@/lib/supabase'
import { cronHandler, forEachClient, callAgent, selfBaseUrl, SkipCounter } from '@/lib/cron'

// GET /api/cron/invoice-chase — NOT SCHEDULED.
//
// Deliberately absent from the crons in vercel.json. This job drafts reminder
// emails into invoice_chase_drafts and nothing anywhere sends them: no code
// reads that table, and the `sent: 0` below is a literal, not a count. Running
// it daily produced AI spend and a rising "drafted" number while no customer
// was ever contacted, which is worse than not running it — the owner believed
// their invoices were being chased.
//
// The code is kept because the drafting works and is the basis of the real
// thing. Before putting it back on a schedule it needs the delivery contract
// the scheduler outbox already has (migration 036): recheck invoice state,
// owner approval, a provider idempotency key, a receipt, and only then advance
// chase_step. Note that nothing currently advances chase_step at all.
//
// Fans out to /api/agents/invoice-chase/run once per active client. That route
// decides which invoices are chaseable (unpaid, unpaused, overdue, below the
// final step) and drafts the next email for each.
//
// WHAT CHANGED: this used to fetch `process.env.NEXT_PUBLIC_APP_URL + ...` with
// that variable unset, catch the resulting throw per client, and return 200
// with `processed: N`. It reported success on every run while chasing nothing.
// The base URL now fails loudly when it cannot be resolved, and the counts in
// the body come from what the agent actually did.

export const runtime = 'nodejs'
export const maxDuration = 120

export const GET = cronHandler({
  name: 'invoice-chase',
  agentType: 'invoice_chase',
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
    let invoicesEligible = 0
    let invoicesDrafted = 0

    const { errors, results } = await forEachClient(list, async (client) => {
      const out = await callAgent(base, '/api/agents/invoice-chase/run', { client_id: client.id })

      const eligible = Number(out?.eligible) || 0
      const drafted = Number(out?.drafted) || 0
      invoicesEligible += eligible
      invoicesDrafted += drafted

      if (eligible === 0) skipped.add('no_overdue_invoices')
      else if (drafted < eligible) skipped.add('draft_failed', eligible - drafted)

      return { eligible, drafted, sent: 0 }
    })

    return {
      scanned: list.length,
      acted: results.filter((r) => r.status === 'ok' && Number(r.drafted) > 0).length,
      skipped: skipped.toJSON(),
      errors,
      detail: { invoices_eligible: invoicesEligible, invoices_drafted: invoicesDrafted, clients: results },
    }
  },
})
