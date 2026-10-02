import { supabaseAdmin } from '@/lib/supabase'
import { cronHandler, forEachClient, callAgent, selfBaseUrl, SkipCounter } from '@/lib/cron'

// GET /api/cron/bi-reporter — Monday, US morning.
//
// Fans out to /api/agents/bi-reporter/generate once per active client with
// send_email: true. That route writes the weekly_briefs row and emails it.
//
// The previous schedule was Sunday 22:00 UTC, which is Sunday afternoon in
// the US — the brief landed before the week it summarised had ended.

export const runtime = 'nodejs'
export const maxDuration = 300

export const GET = cronHandler({
  name: 'bi-reporter',
  agentType: 'bi_reporter',
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

    const { errors, results } = await forEachClient(list, async (client) => {
      const out = await callAgent(base, '/api/agents/bi-reporter/generate', {
        client_id: client.id,
        send_email: true,
      })

      const briefId = out?.brief_id ?? null
      const emailed = out?.emailed === true

      // A brief that was generated but not sent is still worth knowing about
      // — usually COMPANY_POSTAL_ADDRESS or the client's contact_email is
      // missing, and sendBrandedEmail refused.
      //
      // `skipped` is the route's own reason when it has one. It reports
      // already_sent for a week this cron has delivered before, which must not
      // be miscounted as "no brief generated" — on that path no brief is
      // generated on purpose.
      if (out?.skipped) skipped.add(String(out.skipped))
      else if (!briefId) skipped.add('no_brief_generated')
      else if (!emailed) skipped.add('brief_not_emailed')

      return { brief_id: briefId, emailed }
    })

    return {
      scanned: list.length,
      acted: results.filter((r) => r.status === 'ok' && r.emailed === true).length,
      skipped: skipped.toJSON(),
      errors,
      detail: { clients: results },
    }
  },
})
