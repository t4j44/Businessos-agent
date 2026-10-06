import { cronHandler } from '@/lib/cron'
import { supabaseAdmin } from '@/lib/supabase'
import { processSchedulerDelivery } from '@/lib/scheduler-outbox'

// GET /api/cron/scheduler-delivery — drains scheduler_outbox.
//
// THIS SCHEDULE REQUIRES VERCEL PRO. vercel.json runs this every 5 minutes
// ("*/5 * * * *"). Hobby only invokes cron jobs once a day and allows far fewer
// of them, so on Hobby this either will not deploy or will silently run daily —
// which means booking confirmations arrive up to 24 hours late. vercel.json
// cannot carry a comment, so the requirement is recorded here and in
// docs/PILOT_RUNBOOK.md.
//
// Until this was scheduled, confirmations and reminders were queued by
// request_appointment/confirm_appointment and queue_scheduler_reminders and then
// never dispatched: the worker existed and was tested, but nothing ran it.
//
// WHY THESE NUMBERS ARE SAFE IF ONE RUN IS SLOW AND THE NEXT STARTS:
//
//   maxDuration 60s  <  lease 2 min  <  interval 5 min
//
//  * A job is claimed with a 2-minute lease (claim_scheduler_delivery). This
//    function is killed at 60s, so a run can never still be working on a job
//    whose lease has already expired.
//  * scheduler_delivery_candidates excludes leased rows outright
//    (`lease_until IS NULL OR lease_until <= now()`), so a second run does not
//    even see an in-flight job.
//  * If two runs do race between listing and claiming, claim_scheduler_delivery
//    re-checks the lease under FOR UPDATE and refuses the loser. Two layers.
//  * A run killed mid-send leaves the job 'processing' with a lease that expires
//    2 minutes later, so the next run reclaims it. That retry reuses the same
//    `scheduler/<id>` idempotency key, so Resend returns the original receipt
//    rather than delivering a second copy.
//  * Transient failures back off from 60s (doubling, capped at 30 min). The
//    minimum backoff is below the 5-minute interval, so nothing is starved.
//
// BATCH SIZE. p_limit is 3, so this moves at most 36 jobs an hour. That is
// deliberate — 3 sends at Resend's 15s timeout fits inside 60s — but it is a
// throughput ceiling, not just a safety one: a tenant who takes 50 bookings at
// once waits over an hour for the last confirmation. Raising it means raising
// maxDuration too, and maxDuration must stay under the 2-minute lease, so the
// real fix for volume is a shorter interval or a longer lease, not a bigger
// batch. Dispatch is already fair across tenants (candidates ranks by
// per-tenant position), so one busy tenant cannot starve another.
export const maxDuration = 60
export const GET = cronHandler({
  name: 'scheduler-delivery', agentType: 'scheduler',
  async run() {
    const { data, error } = await supabaseAdmin.rpc('scheduler_delivery_candidates', { p_limit: 3 })
    if (error) throw new Error('Delivery queue unavailable.')
    const counts = { scanned: 0, acted: 0, errors: 0, skipped: {} as Record<string, number> }
    for (const job of data || []) {
      counts.scanned++
      const result = await processSchedulerDelivery(job.client_id, job.id)
      if (result.status === 'accepted') counts.acted++
      else if (['storage_error','reconciliation_pending','pending'].includes(result.status)) counts.errors++
      else counts.skipped[result.status] = (counts.skipped[result.status] || 0) + 1
    }
    return counts
  },
})
