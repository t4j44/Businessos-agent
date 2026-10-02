import { getClientContext } from './supabase'
import {
  isSuppressed,
  getUnsubscribeToken,
  unsubscribeUrlFor,
  complianceFooter,
  transactionalFooter,
  postalAddress,
} from './compliance'
import { logAgentRun } from './log'
import { parsePublicUrl } from './safe-fetch'

// Resend is imported lazily inside the send path so that merely importing this
// module (which several routes do) never pulls the SDK into a cold start that
// is not going to send anything. Same shape the bi-reporter and bland webhook
// already use.
export const getResendClient = async () => {
  const { Resend } = await import('resend')
  return new Resend(process.env.RESEND_API_KEY)
}

// Resend rejects any sender on an unverified domain. The rest of the codebase
// sends from businessos.ai, so invoices do too — the client's business name
// rides along as the display name, which is what the recipient actually reads.
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || 'invoices@businessos.ai'

// Values below are interpolated into an HTML email, and customer/company names
// are user-supplied, so they get escaped rather than trusted.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatAmount(amountCents: number): string {
  return (
    '$' +
    (amountCents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

function formatDueDate(dueDate?: string | null): string {
  if (!dueDate) return 'upon receipt'
  const parsed = new Date(dueDate)
  if (Number.isNaN(parsed.getTime())) return 'upon receipt'
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// Domain used for the mailto: half of List-Unsubscribe, derived from the
// configured From address so it matches the sending domain.
const UNSUB_MAIL_DOMAIN = (FROM_ADDRESS.split('@')[1] || 'example.com').replace(/>$/, '')

export type SendEmailResult = {
  sent: boolean
  email_id?: string
  skipped?: string
  error?: string
}

/**
 * Sends one email as the client's business. Shared by every outbound template
 * so the sender identity, key check and error handling live in one place.
 *
 * Never throws — a failed send is reported in the return value.
 */
export type BrandedEmailParams = {
  /** Whose suppression list and unsubscribe token apply. Required. */
  clientId: string
  from_name: string
  to: string
  subject: string
  html: string
  text: string
  /** Where replies land. For "reply to cancel" this must be the business. */
  reply_to?: string | null
  /**
   * A receipt, confirmation or reminder the recipient asked for. Still gets the
   * postal address and the suppression check; omits the marketing unsubscribe
   * copy. Everything else is commercial and gets the full CAN-SPAM footer.
   */
  transactional?: boolean
  /**
   * Passed to Resend as the Idempotency-Key header. Resend remembers a key for
   * 24 hours and returns the original receipt instead of sending again, which
   * is what makes retrying an ambiguous send safe. Must be deterministic for
   * the thing being sent — not per attempt.
   */
  idempotencyKey?: string
}

export type PreparedEmail = {
  from: string; to: string; reply_to?: string; subject: string; html: string; text: string;
  headers: Record<string, string>;
}

// Prepare separately so an outbox can persist the exact body before contacting
// the provider. Retrying must never render a different body under the same key.
export async function prepareBrandedEmail(params: BrandedEmailParams): Promise<PreparedEmail | SendEmailResult> {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, skipped: 'RESEND_API_KEY missing from .env.local' }
  }
  if (!params.to) {
    return { sent: false, skipped: 'No recipient address.' }
  }

  // CAN-SPAM requires a physical postal address in every commercial email.
  // Sending without one is the violation, so this fails loudly rather than
  // quietly shipping a non-compliant message.
  if (!postalAddress()) {
    console.error(
      '[sendBrandedEmail] COMPANY_POSTAL_ADDRESS is unset — refusing to send. ' +
        'CAN-SPAM requires a valid physical postal address in every commercial email.',
    )
    return { sent: false, skipped: 'COMPANY_POSTAL_ADDRESS not configured' }
  }

  if (await isSuppressed(params.clientId, 'email', params.to)) {
    return { sent: false, skipped: 'suppressed' }
  }

  const token = await getUnsubscribeToken(params.clientId, params.to, 'email')
  const unsubscribeUrl = unsubscribeUrlFor(token)
  const footer = params.transactional
    ? transactionalFooter(unsubscribeUrl)
    : complianceFooter(unsubscribeUrl)

  return {
    from: `${params.from_name} <${FROM_ADDRESS}>`, to: params.to,
    reply_to: params.reply_to || undefined, subject: params.subject,
    html: params.html + footer.html, text: params.text + footer.text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@${UNSUB_MAIL_DOMAIN}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}

export async function sendBrandedEmail(params: BrandedEmailParams): Promise<SendEmailResult> {
  try {
    const prepared = await prepareBrandedEmail(params)
    if ('sent' in prepared) return prepared
    const resend = await getResendClient()
    const { data, error } = await resend.emails.send(
      { ...prepared, replyTo: prepared.reply_to },
      params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
    )

    if (error) {
      console.error('[sendBrandedEmail] Resend rejected the send:', error)
      return { sent: false, error: error.message || String(error) }
    }
    if (!data?.id) return { sent: false, error: 'Email provider returned no receipt.' }
    return { sent: true, email_id: data.id }
  } catch (err: any) {
    console.error('[sendBrandedEmail] send failed:', err)
    return { sent: false, error: err?.message || String(err) }
  }
}

export type SendInvoiceEmailParams = {
  client_id: string
  customer_email: string
  customer_name?: string | null
  amount_cents: number
  due_date?: string | null
  /** Human-facing invoice reference — falls back to a short form of the row id. */
  invoice_number: string
  /** Row id for the agent_runs record. */
  invoice_id?: string
  /** A real hosted payment URL, if one exists. */
  payment_url?: string
}

export type SendInvoiceEmailResult = {
  sent: boolean
  email_id?: string
  skipped?: string
  error?: string
}

/**
 * Sends the first-touch invoice email for a newly logged invoice and records a
 * successful send in agent_runs.
 *
 * Never throws: a failed send is reported in the return value so it cannot take
 * down the invoice write that triggered it.
 */
export async function sendInvoiceEmail(
  params: SendInvoiceEmailParams,
): Promise<SendInvoiceEmailResult> {
  const {
    client_id,
    customer_email,
    customer_name,
    amount_cents,
    due_date,
    invoice_number,
    invoice_id,
    payment_url,
  } = params

  if (!process.env.RESEND_API_KEY) {
    return { sent: false, skipped: 'RESEND_API_KEY missing from .env.local' }
  }
  if (!customer_email) {
    return { sent: false, skipped: 'Invoice has no customer_email to send to.' }
  }

  try {
    // The sender identity is the client's business, not Business OS.
    const { client, brand } = await getClientContext(client_id)
    const companyName = brand?.company_name || client?.name || 'Our team'

    const amount = formatAmount(Number(amount_cents) || 0)
    const due = formatDueDate(due_date)
    const greetingName = (customer_name || '').trim() || 'there'

    let link: string | null = null
    if (payment_url) {
      const parsed = parsePublicUrl(payment_url)
      if (parsed.protocol !== 'https:') return { sent: false, error: 'Payment URL must use HTTPS.' }
      link = parsed.href
    }

    const safeCompany = escapeHtml(companyName)
    const safeName = escapeHtml(greetingName)
    const safeNumber = escapeHtml(invoice_number)
    const safeLink = link ? escapeHtml(link) : null

    const subject = `Invoice ${invoice_number} from ${companyName} — ${amount} due ${due}`

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;max-width:560px;">
        <p>Hi ${safeName},</p>

        <p>Thanks for working with ${safeCompany} — we really appreciate it.
        Here's invoice <strong>${safeNumber}</strong> for your records.</p>

        <table style="border-collapse:collapse;margin:20px 0;width:100%;background:#f8fafc;border-radius:8px;">
          <tr>
            <td style="padding:14px 16px;color:#64748b;">Amount due</td>
            <td style="padding:14px 16px;text-align:right;font-weight:600;font-size:18px;">${amount}</td>
          </tr>
          <tr>
            <td style="padding:14px 16px;color:#64748b;border-top:1px solid #e2e8f0;">Due date</td>
            <td style="padding:14px 16px;text-align:right;font-weight:600;border-top:1px solid #e2e8f0;">${escapeHtml(due)}</td>
          </tr>
        </table>

        ${safeLink ? `<p style="margin:24px 0;">
          <a href="${safeLink}" style="background:#2563EB;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block;">Pay this invoice</a>
        </p>` : '<p>Contact the business to arrange payment.</p>'}

        <p>If anything looks off, or if the timing is tricky this month, just reply
        to this email — we're happy to sort it out with you.</p>

        <p style="margin-top:24px;">Warm regards,<br />${safeCompany}</p>
      </div>
    `.trim()

    const text = [
      `Hi ${greetingName},`,
      '',
      `Thanks for working with ${companyName} — we really appreciate it.`,
      `Here's invoice ${invoice_number} for your records.`,
      '',
      `Amount due: ${amount}`,
      `Due date: ${due}`,
      '',
      link ? `Pay this invoice: ${link}` : 'Contact the business to arrange payment.',
      '',
      `If anything looks off, or if the timing is tricky this month, just reply to`,
      `this email — we're happy to sort it out with you.`,
      '',
      'Warm regards,',
      companyName,
    ].join('\n')

    // Same compliance path as sendBrandedEmail: an invoice is transactional,
    // but the chase ladder that follows it is debt collection, so these
    // recipients must still be able to opt out and must see a postal address.
    if (!postalAddress()) {
      console.error(
        '[sendInvoiceEmail] COMPANY_POSTAL_ADDRESS is unset — refusing to send.',
      )
      return { sent: false, skipped: 'COMPANY_POSTAL_ADDRESS not configured' }
    }

    if (await isSuppressed(client_id, 'email', customer_email)) {
      return { sent: false, skipped: 'suppressed' }
    }

    const unsubToken = await getUnsubscribeToken(client_id, customer_email, 'email')
    const unsubUrl = unsubscribeUrlFor(unsubToken)
    const invoiceFooter = transactionalFooter(unsubUrl)

    const resend = await getResendClient()
    const { data, error } = await resend.emails.send({
      from: `${companyName} <${FROM_ADDRESS}>`,
      to: customer_email,
      replyTo: client?.contact_email || undefined,
      subject,
      html: html + invoiceFooter.html,
      text: text + invoiceFooter.text,
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>, <mailto:unsubscribe@${UNSUB_MAIL_DOMAIN}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })

    if (error) {
      console.error('[sendInvoiceEmail] Resend rejected the send:', error)
      return { sent: false, error: error.message || String(error) }
    }

    if (!data?.id) return { sent: false, error: 'Email provider returned no receipt.' }
    // Provider acceptance is evidence of submission, not inbox delivery.
    await logAgentRun({
      client_id,
      agent_type: 'invoice_chase',
      status: 'completed',
      output_summary: `Invoice email sent to ${customer_email} for ${invoice_number} (${amount})`,
      metadata: {
        step: 'invoice_created_email',
        invoice_id: invoice_id || null,
        invoice_number,
        customer_email,
        amount_cents: Number(amount_cents) || 0,
        due_date: due_date || null,
        resend_email_id: data?.id || null,
      },
    })

    return { sent: true, email_id: data?.id }
  } catch (err: any) {
    console.error('[sendInvoiceEmail] send failed:', err)
    return { sent: false, error: err?.message || String(err) }
  }
}
