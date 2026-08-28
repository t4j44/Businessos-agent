import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase'

// CAN-SPAM / TCPA plumbing shared by every outbound channel.
//
// The rule this file exists to enforce: an address that has opted out must not
// be contacted again on that channel, and every commercial email must carry a
// physical postal address and a working unsubscribe link.

export type Channel = 'email' | 'sms'

/** Addresses are compared case-insensitively and trimmed. */
function normalise(address: string): string {
  return String(address || '').trim().toLowerCase()
}

/**
 * True when this address must not be contacted.
 *
 * Fails CLOSED on a database error: if the suppression list cannot be read we
 * treat the recipient as suppressed rather than risk mailing someone who opted
 * out. A missed send is recoverable; a CAN-SPAM violation is not.
 */
export async function isSuppressed(
  clientId: string,
  channel: Channel,
  address: string,
): Promise<boolean> {
  const target = normalise(address)
  if (!target) return true

  try {
    const { data, error } = await supabaseAdmin
      .from('suppression_list')
      .select('id')
      .eq('client_id', clientId)
      .eq('channel', channel)
      .eq('address', target)
      .maybeSingle()

    if (error) {
      console.error('[compliance] suppression lookup failed — treating as suppressed:', error.message)
      return true
    }
    return !!data
  } catch (err) {
    console.error('[compliance] suppression lookup threw — treating as suppressed:', err)
    return true
  }
}

/** Adds an address to the suppression list. Idempotent. */
export async function suppress(
  clientId: string,
  channel: Channel,
  address: string,
  reason: string,
): Promise<void> {
  const target = normalise(address)
  if (!target) return

  const { error } = await supabaseAdmin
    .from('suppression_list')
    .upsert(
      { client_id: clientId, channel, address: target, reason },
      { onConflict: 'client_id,channel,address', ignoreDuplicates: true },
    )

  if (error) {
    console.error('[compliance] suppress failed:', error.message)
  }
}

/**
 * A stable, unguessable unsubscribe token for this recipient, created on first
 * call. Stable on purpose — an unsubscribe link in a months-old email must
 * still work.
 */
export async function getUnsubscribeToken(
  clientId: string,
  address: string,
  channel: Channel = 'email',
): Promise<string> {
  const target = normalise(address)

  const { data: existing } = await supabaseAdmin
    .from('unsubscribe_tokens')
    .select('token')
    .eq('client_id', clientId)
    .eq('channel', channel)
    .eq('address', target)
    .maybeSingle()

  if (existing?.token) return existing.token

  const token = randomBytes(32).toString('base64url')

  const { error } = await supabaseAdmin
    .from('unsubscribe_tokens')
    .insert({ token, client_id: clientId, channel, address: target })

  if (error) {
    // A concurrent send may have created it first — re-read before giving up.
    const { data: raced } = await supabaseAdmin
      .from('unsubscribe_tokens')
      .select('token')
      .eq('client_id', clientId)
      .eq('channel', channel)
      .eq('address', target)
      .maybeSingle()

    if (raced?.token) return raced.token
    console.error('[compliance] could not persist unsubscribe token:', error.message)
  }

  return token
}

export function companyName(): string {
  return process.env.COMPANY_NAME?.trim() || 'Business OS'
}

/** CAN-SPAM requires a real postal address; there is no safe default. */
export function postalAddress(): string | null {
  const value = process.env.COMPANY_POSTAL_ADDRESS?.trim()
  return value || null
}

/**
 * The CAN-SPAM footer. Muted grey, small, separated by a top border, matching
 * the existing template.
 */
export function complianceFooter(unsubscribeUrl: string): { html: string; text: string } {
  const name = companyName()
  const postal = postalAddress() ?? ''

  const html = `
  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #E4E4E7;font-size:12px;line-height:1.6;color:#71717A;">
    <p style="margin:0 0 6px;">
      You are receiving this email because you are a customer of, or enquired with, ${name}.
    </p>
    <p style="margin:0 0 6px;">${name} &middot; ${postal}</p>
    <p style="margin:0;">
      <a href="${unsubscribeUrl}" style="color:#71717A;text-decoration:underline;">Unsubscribe</a>
      from these emails.
    </p>
  </div>`

  const text = `
---
You are receiving this email because you are a customer of, or enquired with, ${name}.
${name} · ${postal}
Unsubscribe: ${unsubscribeUrl}`

  return { html, text }
}

/**
 * The transactional variant. A receipt or appointment confirmation the customer
 * asked for still needs the sender identity and postal address, but not the
 * marketing unsubscribe copy.
 */
export function transactionalFooter(unsubscribeUrl: string): { html: string; text: string } {
  const name = companyName()
  const postal = postalAddress() ?? ''

  const html = `
  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #E4E4E7;font-size:12px;line-height:1.6;color:#71717A;">
    <p style="margin:0 0 6px;">This is a service message about your account or booking.</p>
    <p style="margin:0 0 6px;">${name} &middot; ${postal}</p>
    <p style="margin:0;">
      <a href="${unsubscribeUrl}" style="color:#71717A;text-decoration:underline;">Manage email preferences</a>
    </p>
  </div>`

  const text = `
---
This is a service message about your account or booking.
${name} · ${postal}
Manage email preferences: ${unsubscribeUrl}`

  return { html, text }
}

export function unsubscribeUrlFor(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || ''
  return `${base}/api/unsubscribe?token=${encodeURIComponent(token)}`
}

/**
 * TCPA: an SMS may only go to someone who actually consented, and the consent
 * has to be on record. Checks leads first, then contacts.
 */
export async function hasPhoneConsent(clientId: string, phone: string): Promise<boolean> {
  const target = String(phone || '').trim()
  if (!target) return false

  try {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('phone_consent')
      .eq('client_id', clientId)
      .eq('phone', target)
      .maybeSingle()

    if (lead) return lead.phone_consent === true

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('phone_consent')
      .eq('client_id', clientId)
      .eq('phone', target)
      .maybeSingle()

    return contact?.phone_consent === true
  } catch (err) {
    console.error('[compliance] consent lookup failed — treating as no consent:', err)
    return false
  }
}
