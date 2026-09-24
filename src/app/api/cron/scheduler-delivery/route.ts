import { cronHandler } from '@/lib/cron'
import { supabaseAdmin } from '@/lib/supabase'
import { processSchedulerDelivery } from '@/lib/scheduler-outbox'

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
