import { supabaseAdmin } from '@/lib/supabase'
import { cronHandler } from '@/lib/cron'

// Email-only pilot reminders use the same leased outbox as confirmations.
// SMS has no retry-safe delivery contract yet and is not dispatched here.
export const runtime = 'nodejs'
export const maxDuration = 60
export const GET = cronHandler({
  name: 'appointment-reminders', agentType: 'scheduler',
  async run() {
    const { data, error } = await supabaseAdmin.rpc('queue_scheduler_reminders')
    if (error) throw new Error('Could not enqueue appointment reminders.')
    return { scanned: data || 0, acted: data || 0, errors: 0, skipped: {}, detail: { queued: data || 0, sent: 0, channel: 'email' } }
  },
})
