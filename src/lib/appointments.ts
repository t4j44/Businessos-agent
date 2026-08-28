import { getClientContext } from './supabase'
import { escapeHtml, sendBrandedEmail, type SendEmailResult } from './resend'

// Shared context and email templates for the scheduler agent. The routes handle
// HTTP and persistence; everything a customer or client actually reads is here,
// so the four touchpoints (request, alert, confirm, reminder) stay consistent.

export type SchedulerContext = {
  /** Needed for the suppression check and unsubscribe token. */
  clientId: string
  companyName: string
  /** Where the business receives alerts and where "reply to cancel" lands. */
  contactEmail: string | null
  contactPhone: string | null
}

export async function getSchedulerContext(clientId: string): Promise<SchedulerContext> {
  const { client, brand } = await getClientContext(clientId)

  const info = brand?.contact_info
  const brandPhone =
    info && typeof info === 'object' ? info.phone || info.telephone || info.tel : null

  return {
    clientId,
    companyName: brand?.company_name || client?.name || 'our team',
    contactEmail: client?.contact_email?.trim() || null,
    contactPhone: (brandPhone || client?.contact_phone || '').trim() || null,
  }
}

export function formatDate(date?: string | null): string {
  if (!date) return 'your requested date'
  // A bare YYYY-MM-DD parses as UTC midnight; forcing UTC formatting stops it
  // rendering as the previous day west of Greenwich.
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatWhen(date?: string | null, time?: string | null): string {
  const d = formatDate(date)
  const t = (time || '').trim()
  return t ? `${d} at ${t}` : d
}

const WRAP_OPEN =
  '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;max-width:560px;">'
const WRAP_CLOSE = '</div>'

function detailTable(rows: Array<[string, string]>): string {
  const cells = rows
    .map(
      ([label, value], i) =>
        `<tr><td style="padding:12px 16px;color:#64748b;${i ? 'border-top:1px solid #e2e8f0;' : ''}">${escapeHtml(label)}</td>` +
        `<td style="padding:12px 16px;text-align:right;font-weight:600;${i ? 'border-top:1px solid #e2e8f0;' : ''}">${escapeHtml(value)}</td></tr>`,
    )
    .join('')
  return `<table style="border-collapse:collapse;margin:20px 0;width:100%;background:#f8fafc;border-radius:8px;">${cells}</table>`
}

// ── 1. Customer: "we got your request" ───────────────────────────────────────
export async function sendRequestReceivedEmail(params: {
  ctx: SchedulerContext
  customerName?: string | null
  customerEmail: string
  requestedDate?: string | null
  requestedTime?: string | null
  serviceType?: string | null
}): Promise<SendEmailResult> {
  const { ctx, customerName, customerEmail, requestedDate, requestedTime, serviceType } = params
  const name = (customerName || '').trim() || 'there'
  const when = formatWhen(requestedDate, requestedTime)

  const rows: Array<[string, string]> = [['Requested time', when]]
  if (serviceType) rows.push(['Service', serviceType])

  const html =
    WRAP_OPEN +
    `<p>Hi ${escapeHtml(name)},</p>` +
    `<p>Thanks for getting in touch with ${escapeHtml(ctx.companyName)} — we've got your request and someone will confirm it within 2 hours.</p>` +
    detailTable(rows) +
    `<p>This isn't a confirmed booking just yet. We'll email you again as soon as it's locked in.</p>` +
    (ctx.contactPhone
      ? `<p>Need it sooner? Give us a call on ${escapeHtml(ctx.contactPhone)}.</p>`
      : '') +
    `<p style="margin-top:24px;">See you soon,<br />${escapeHtml(ctx.companyName)}</p>` +
    WRAP_CLOSE

  const text = [
    `Hi ${name},`,
    '',
    `Thanks for getting in touch with ${ctx.companyName} — we've got your request and`,
    'someone will confirm it within 2 hours.',
    '',
    `Requested time: ${when}`,
    serviceType ? `Service: ${serviceType}` : '',
    '',
    "This isn't a confirmed booking just yet. We'll email you again as soon as it's",
    'locked in.',
    ctx.contactPhone ? `\nNeed it sooner? Give us a call on ${ctx.contactPhone}.` : '',
    '',
    'See you soon,',
    ctx.companyName,
  ]
    .filter((l) => l !== '')
    .join('\n')

  return sendBrandedEmail({
    clientId: ctx.clientId,
    transactional: true,
    from_name: ctx.companyName,
    to: customerEmail,
    subject: `We've received your request — ${ctx.companyName}`,
    html,
    text,
    reply_to: ctx.contactEmail,
  })
}

// ── 2. Business: "new request came in" ───────────────────────────────────────
export async function sendClientAlertEmail(params: {
  ctx: SchedulerContext
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  requestedDate?: string | null
  requestedTime?: string | null
  serviceType?: string | null
  notes?: string | null
}): Promise<SendEmailResult> {
  const { ctx, customerName, customerEmail, customerPhone, requestedDate, requestedTime, serviceType, notes } =
    params

  if (!ctx.contactEmail) {
    return { sent: false, skipped: 'Client has no contact_email to alert.' }
  }

  const name = (customerName || '').trim() || 'A new customer'
  const when = formatWhen(requestedDate, requestedTime)

  const rows: Array<[string, string]> = [['Requested', when]]
  if (serviceType) rows.push(['Service', serviceType])
  if (customerEmail) rows.push(['Email', customerEmail])
  if (customerPhone) rows.push(['Phone', customerPhone])

  const html =
    WRAP_OPEN +
    `<p><strong>${escapeHtml(name)}</strong> has requested an appointment.</p>` +
    detailTable(rows) +
    (notes ? `<p><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : '') +
    `<p>They've been told someone will confirm within 2 hours.</p>` +
    WRAP_CLOSE

  const text = [
    `${name} has requested an appointment.`,
    '',
    `Requested: ${when}`,
    serviceType ? `Service: ${serviceType}` : '',
    customerEmail ? `Email: ${customerEmail}` : '',
    customerPhone ? `Phone: ${customerPhone}` : '',
    notes ? `\nNotes: ${notes}` : '',
    '',
    "They've been told someone will confirm within 2 hours.",
  ]
    .filter((l) => l !== '')
    .join('\n')

  return sendBrandedEmail({
    clientId: ctx.clientId,
    transactional: true,
    from_name: `${ctx.companyName} Bookings`,
    to: ctx.contactEmail,
    subject: `New appointment request from ${name} for ${when}`,
    html,
    text,
    // Replying goes straight back to the customer where possible.
    reply_to: customerEmail || null,
  })
}

// ── 3. Customer: "you're confirmed" ──────────────────────────────────────────
export async function sendConfirmationEmail(params: {
  ctx: SchedulerContext
  customerName?: string | null
  customerEmail: string
  confirmedDate?: string | null
  confirmedTime?: string | null
  serviceType?: string | null
}): Promise<SendEmailResult> {
  const { ctx, customerName, customerEmail, confirmedDate, confirmedTime, serviceType } = params
  const name = (customerName || '').trim() || 'there'
  const when = formatWhen(confirmedDate, confirmedTime)

  const rows: Array<[string, string]> = [
    ['Business', ctx.companyName],
    ['Date & time', when],
  ]
  if (serviceType) rows.push(['Service', serviceType])

  // "Reply to cancel" is only true if replies reach the business. When no
  // contact_email is on file, replies would land on the unmonitored sending
  // address, so the instruction changes to something that actually works.
  const cancelLine = ctx.contactEmail
    ? 'Need to cancel or change it? Just reply to this email and we’ll sort it out.'
    : ctx.contactPhone
      ? `Need to cancel or change it? Give us a call on ${ctx.contactPhone}.`
      : 'Need to cancel or change it? Get in touch and we’ll sort it out.'

  const html =
    WRAP_OPEN +
    `<p>Hi ${escapeHtml(name)},</p>` +
    `<p>You're confirmed with ${escapeHtml(ctx.companyName)}. We're looking forward to seeing you.</p>` +
    detailTable(rows) +
    `<p>${escapeHtml(cancelLine)}</p>` +
    `<p style="margin-top:24px;">See you then,<br />${escapeHtml(ctx.companyName)}</p>` +
    WRAP_CLOSE

  const text = [
    `Hi ${name},`,
    '',
    `You're confirmed with ${ctx.companyName}. We're looking forward to seeing you.`,
    '',
    `Business: ${ctx.companyName}`,
    `Date & time: ${when}`,
    serviceType ? `Service: ${serviceType}` : '',
    '',
    cancelLine,
    '',
    'See you then,',
    ctx.companyName,
  ]
    .filter((l) => l !== '')
    .join('\n')

  return sendBrandedEmail({
    clientId: ctx.clientId,
    transactional: true,
    from_name: ctx.companyName,
    to: customerEmail,
    subject: `Confirmed: your appointment with ${ctx.companyName} — ${when}`,
    html,
    text,
    reply_to: ctx.contactEmail,
  })
}

// ── 4. Customer: day-before reminder ─────────────────────────────────────────
export function buildReminderText(params: {
  ctx: SchedulerContext
  customerName?: string | null
  when: string
  serviceType?: string | null
}): string {
  const { ctx, customerName, when, serviceType } = params
  const name = (customerName || '').trim()
  return [
    name ? `Hi ${name} —` : 'Hi —',
    `a reminder of your${serviceType ? ` ${serviceType}` : ''} appointment with ${ctx.companyName} tomorrow, ${when}.`,
    ctx.contactPhone ? `Need to change it? Call ${ctx.contactPhone}.` : 'Reply if you need to change it.',
  ].join(' ')
}

export async function sendReminderEmail(params: {
  ctx: SchedulerContext
  customerName?: string | null
  customerEmail: string
  when: string
  serviceType?: string | null
}): Promise<SendEmailResult> {
  const { ctx, customerName, customerEmail, when, serviceType } = params
  const name = (customerName || '').trim() || 'there'

  const rows: Array<[string, string]> = [['Date & time', when]]
  if (serviceType) rows.push(['Service', serviceType])

  const html =
    WRAP_OPEN +
    `<p>Hi ${escapeHtml(name)},</p>` +
    `<p>Just a quick reminder about your appointment with ${escapeHtml(ctx.companyName)} tomorrow.</p>` +
    detailTable(rows) +
    (ctx.contactEmail
      ? '<p>Need to cancel or change it? Just reply to this email.</p>'
      : ctx.contactPhone
        ? `<p>Need to cancel or change it? Give us a call on ${escapeHtml(ctx.contactPhone)}.</p>`
        : '') +
    `<p style="margin-top:24px;">See you tomorrow,<br />${escapeHtml(ctx.companyName)}</p>` +
    WRAP_CLOSE

  const text = [
    `Hi ${name},`,
    '',
    `Just a quick reminder about your appointment with ${ctx.companyName} tomorrow.`,
    '',
    `Date & time: ${when}`,
    serviceType ? `Service: ${serviceType}` : '',
    '',
    ctx.contactEmail
      ? 'Need to cancel or change it? Just reply to this email.'
      : ctx.contactPhone
        ? `Need to cancel or change it? Give us a call on ${ctx.contactPhone}.`
        : '',
    '',
    'See you tomorrow,',
    ctx.companyName,
  ]
    .filter((l) => l !== '')
    .join('\n')

  return sendBrandedEmail({
    clientId: ctx.clientId,
    transactional: true,
    from_name: ctx.companyName,
    to: customerEmail,
    subject: `Reminder: your appointment with ${ctx.companyName} tomorrow`,
    html,
    text,
    reply_to: ctx.contactEmail,
  })
}
