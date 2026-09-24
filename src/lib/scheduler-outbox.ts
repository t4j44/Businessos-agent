import { supabaseAdmin } from './supabase'
import { getSchedulerContext, sendRequestReceivedEmail, sendClientAlertEmail, sendConfirmationEmail, sendReminderEmail, formatWhen } from './appointments'
import { prepareBrandedEmail, type BrandedEmailParams, type PreparedEmail, type SendEmailResult } from './resend'
import { isSuppressed } from './compliance'

type Delivery = { id: string; client_id: string; lease_id: string; kind: string; prepared_email: PreparedEmail | null; snapshot: Record<string, any> }
export type DeliveryResult = { status: string; provider_id?: string }

export async function processSchedulerDelivery(clientId: string, id: string): Promise<DeliveryResult> {
  const { data, error } = await supabaseAdmin.rpc('claim_scheduler_delivery', { p_client_id: clientId, p_id: id })
  if (error) return { status: 'storage_error' }
  if (!data) return { status: 'not_claimed' }
  const item: Delivery = data
  const identity = { p_client_id: clientId, p_id: id, p_lease: item.lease_id }
  const finish = async (status: string, code: string | null = null, providerId: string | null = null) => {
    const result = await supabaseAdmin.rpc('finish_scheduler_delivery', {
      ...identity, p_status: status, p_provider_id: providerId, p_error: code,
    })
    // A provider receipt without durable acknowledgement remains recoverable by
    // the same key, and must not be represented as a completed delivery.
    return { status: result.error || result.data !== true ? 'reconciliation_pending' : status,
      ...(providerId ? { provider_id: providerId } : {}) }
  }
  try {
    if (!process.env.RESEND_API_KEY) return finish('blocked', 'email_not_configured')
    let email = item.prepared_email
    if (!email) {
      const ctx = await getSchedulerContext(clientId)
      const booking = item.snapshot
      let preparationFailure: SendEmailResult | undefined
      const capture = async (params: BrandedEmailParams): Promise<SendEmailResult> => {
        const prepared = await prepareBrandedEmail(params)
        if ('sent' in prepared) { preparationFailure = prepared; return prepared }
        email = { ...prepared, html: `${prepared.html}\n<!-- businessos-delivery:${id} -->` }
        return { sent: false, skipped: 'Prepared for durable dispatch.' }
      }
      const common = { ctx, customerName: booking.customer_name, customerEmail: booking.customer_email, serviceType: booking.service_type }
      if (item.kind === 'request_received') await sendRequestReceivedEmail({ ...common, requestedDate: booking.requested_date, requestedTime: booking.requested_time }, capture)
      else if (item.kind === 'owner_alert') {
        if (!ctx.contactEmail) return finish('blocked', 'owner_email_missing')
        await sendClientAlertEmail({ ...common, customerPhone: booking.customer_phone, requestedDate: booking.requested_date,
          requestedTime: booking.requested_time, notes: booking.notes }, capture)
      } else if (item.kind === 'confirmation') await sendConfirmationEmail({ ...common, confirmedDate: booking.confirmed_date, confirmedTime: booking.confirmed_time }, capture)
      else if (item.kind === 'reminder') await sendReminderEmail({ ...common, when: formatWhen(booking.confirmed_date, booking.confirmed_time) }, capture)
      else return finish('review', 'unknown_delivery_kind')
      if (!email) return finish('blocked', preparationFailure?.skipped === 'suppressed' ? 'suppressed_or_unavailable' : 'email_configuration_required')
      const saved = await supabaseAdmin.rpc('prepare_scheduler_delivery', { ...identity, p_email: email })
      if (saved.error || !saved.data) return { status: 'storage_error' }
      email = saved.data as PreparedEmail
    }
    // Recheck opt-outs before every attempt, including previously prepared mail.
    if (await isSuppressed(clientId, 'email', email.to)) return finish('blocked', 'suppressed_or_unavailable')
    const started = await supabaseAdmin.rpc('begin_scheduler_send', identity)
    if (started.error) return { status: 'storage_error' }
    if (started.data !== true) return finish('review', 'send_precondition_changed')
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `scheduler/${id}` },
      body: JSON.stringify(email), signal: AbortSignal.timeout(15_000),
    })
    const receipt = await response.json().catch(() => null)
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500 || receipt?.name === 'concurrent_idempotent_requests'
      return finish(retryable ? 'pending' : 'blocked', `provider_http_${response.status}`)
    }
    if (typeof receipt?.id !== 'string' || !receipt.id) return finish('pending', 'provider_receipt_missing')
    return finish('accepted', null, receipt.id)
  } catch {
    // Includes timeouts: the provider may already have accepted the email.
    // Never switch the key or discard the prepared payload on this path.
    return finish('pending', 'delivery_attempt_failed')
  }
}

export async function reconcileSchedulerDelivery(clientId: string, userId: string, id: string, providerId: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false
  const { data: job, error } = await supabaseAdmin.from('scheduler_outbox').select('prepared_email,first_attempt_at,status')
    .eq('id', id).eq('client_id', clientId).maybeSingle()
  if (error || !job?.prepared_email || !job.first_attempt_at || !['review','blocked','pending'].includes(job.status)) return false
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(10_000), cache: 'no-store',
  })
  if (!response.ok) return false
  const receipt = await response.json()
  const email = job.prepared_email as PreparedEmail
  if (receipt.id !== providerId || receipt.html !== email.html || !email.html.includes(`<!-- businessos-delivery:${id} -->`)
    || receipt.subject !== email.subject || receipt.from !== email.from || !Array.isArray(receipt.to)
    || receipt.to.length !== 1 || receipt.to[0].toLowerCase() !== email.to.toLowerCase()) return false
  const saved = await supabaseAdmin.rpc('reconcile_scheduler_delivery', {
    p_client_id: clientId, p_id: id, p_user_id: userId, p_provider_id: providerId,
  })
  return !saved.error && saved.data === true
}
