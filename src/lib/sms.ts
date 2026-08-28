// Twilio SMS over the REST API.
//
// Deliberately no `twilio` npm package: one authenticated POST does not justify
// a dependency, and the rest of this codebase already talks to Resend and
// OpenRouter the same way.

import { isSuppressed, hasPhoneConsent } from './compliance'

// TCPA: every message must carry a working opt-out, and the opt-out must
// survive truncation — so the body is trimmed to fit around it, never the
// other way round.
const OPT_OUT = ' Reply STOP to opt out.'
const SEGMENT_LIMIT = 160

export type SendSMSResult = {
  sent: boolean
  message_sid?: string
  skipped?: string
  error?: string
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
  )
}

/**
 * Sends one SMS. Never throws — callers fall back to email on a false result.
 */
export async function sendSMS(
  to: string,
  body: string,
  /** Whose suppression list and consent record apply. */
  clientId?: string,
): Promise<SendSMSResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER

  // A sending number is as required as the credentials — Twilio rejects the
  // request without it, so treat a missing one as "not configured" rather than
  // discovering it as a 400 per recipient.
  if (!sid || !token || !from) {
    return {
      sent: false,
      skipped:
        'Twilio not configured — needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER.',
    }
  }
  if (!to) {
    return { sent: false, skipped: 'No phone number on the appointment.' }
  }

  // TCPA gates. Without a client we cannot check either list, so we do not send.
  if (!clientId) {
    console.warn('[sendSMS] no clientId supplied — refusing to send (cannot verify consent)')
    return { sent: false, skipped: 'no clientId — consent unverifiable' }
  }

  if (await isSuppressed(clientId, 'sms', to)) {
    return { sent: false, skipped: 'suppressed' }
  }

  if (!(await hasPhoneConsent(clientId, to))) {
    console.warn('[sendSMS] no phone_consent on record for this number — not sending')
    return { sent: false, skipped: 'no phone consent on record' }
  }

  // Truncate the message, never the opt-out.
  const room = SEGMENT_LIMIT - OPT_OUT.length
  const trimmed = body.length > room ? body.slice(0, room - 1).trimEnd() + '…' : body
  const finalBody = trimmed + OPT_OUT

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: finalBody }),
      },
    )

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const detail = data?.message || `HTTP ${res.status}`
      console.error('[sendSMS] Twilio rejected the send:', detail)
      return { sent: false, error: detail }
    }

    return { sent: true, message_sid: data?.sid }
  } catch (err: any) {
    console.error('[sendSMS] send failed:', err)
    return { sent: false, error: err?.message || String(err) }
  }
}
