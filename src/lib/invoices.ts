import { supabaseAdmin } from './supabase'
import { sendInvoiceEmail, type SendInvoiceEmailResult } from './resend'
import { isDate, isUuid, ValidationError } from './validation'
import { parsePublicUrl } from './safe-fetch'

// Single choke point for logging a new invoice.
//
// Nothing in the codebase inserted into `invoices` before this — every other
// call site only read or updated rows created out of band. Routing all creation
// through here is what makes "email fires when an invoice is logged" hold for
// future callers (Stripe webhook, CSV import) rather than just one endpoint.

export type CreateInvoiceParams = {
  client_id: string
  customer_email: string
  customer_name?: string | null
  amount_cents: number
  due_date?: string | null
  stripe_invoice_id?: string | null
  contact_id?: string | null
  /** Optional real hosted payment URL. No payment page is invented. */
  payment_url?: string
  /** Escape hatch for backfills/imports that should not email anyone. */
  send_email?: boolean
}

export type CreateInvoiceResult = {
  invoice: any
  email: SendInvoiceEmailResult
}

export async function createInvoice(
  params: CreateInvoiceParams,
): Promise<CreateInvoiceResult> {
  const {
    client_id,
    customer_email,
    customer_name,
    amount_cents,
    due_date,
    stripe_invoice_id,
    contact_id,
    payment_url,
    send_email = true,
  } = params

  if (!isUuid(client_id) || typeof customer_email !== 'string' || customer_email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) throw new ValidationError('A valid customer email is required.')
  if (!Number.isSafeInteger(amount_cents) || amount_cents <= 0 || amount_cents > 2147483647) {
    throw new ValidationError('Amount must be a positive whole number of cents within the supported limit.')
  }
  if (due_date != null && !isDate(due_date)) throw new ValidationError('A valid due date is required.')
  for (const value of [customer_name, stripe_invoice_id]) {
    if (value != null && (typeof value !== 'string' || value.length > 200)) throw new ValidationError('Invoice name or reference is too long.')
  }
  if (payment_url != null) {
    try { if (parsePublicUrl(payment_url).protocol !== 'https:') throw new Error('HTTPS required') }
    catch { throw new ValidationError('Payment URL must be a public HTTPS URL.') }
  }
  if (contact_id != null) {
    if (!isUuid(contact_id)) throw new ValidationError('Invalid customer ID.')
    const { data: contact, error: contactError } = await supabaseAdmin.from('contacts').select('id')
      .eq('client_id', client_id).eq('id', contact_id).maybeSingle()
    if (contactError) throw new Error('Customer lookup is unavailable.')
    if (!contact) throw new ValidationError('Customer not found.', 404)
  }

  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .insert({
      client_id,
      customer_name: customer_name || null,
      customer_email,
      amount_cents: Math.round(Number(amount_cents) || 0),
      due_date: due_date || null,
      stripe_invoice_id: stripe_invoice_id || null,
      contact_id: contact_id || null,
      status: 'draft',
      days_overdue: 0,
      // 0 means "no chase step taken yet" — the initial email below is the
      // first touch, not part of the 1-5 overdue ladder, which only starts
      // once days_overdue goes positive.
      chase_step: 0,
    })
    .select('id, client_id, customer_name, customer_email, amount_cents, due_date, status, chase_step, created_at')
    .single()

  if (error) {
    // A failed insert is fatal for the caller — there is no invoice to email.
    throw new Error(error.message)
  }

  if (!send_email) {
    return { invoice, email: { sent: false, skipped: 'send_email was false.' } }
  }

  // Awaited, not fire-and-forget: on serverless the function can be frozen the
  // moment the response is returned, which would drop an unawaited send.
  const email = await sendInvoiceEmail({
    client_id,
    customer_email,
    customer_name,
    amount_cents: invoice.amount_cents,
    due_date: invoice.due_date,
    invoice_number: stripe_invoice_id || String(invoice.id).slice(0, 8),
    invoice_id: invoice.id,
    payment_url,
  })

  if (email.sent && email.email_id) {
    const { data: updated, error: updateError } = await supabaseAdmin.from('invoices')
      .update({ status: 'sent' }).eq('client_id', client_id).eq('id', invoice.id).eq('status', 'draft')
      .select('status').maybeSingle()
    if (updateError || !updated) {
      // Do not throw after a confirmed provider acceptance: retrying creation
      // could send twice. Return the actual saved state and recovery warning.
      return { invoice, email: { ...email, error: 'Email accepted, but invoice status needs reconciliation. Do not create it again.' } }
    }
    invoice.status = updated.status
  }

  return { invoice, email }
}
