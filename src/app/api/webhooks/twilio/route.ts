import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { suppress, companyName } from '@/lib/compliance'

// POST /api/webhooks/twilio — inbound SMS.
//
// This is how STOP actually takes effect. Twilio also honours STOP at the
// carrier level, but the opt-out has to reach our own suppression list or the
// next agent run would still queue a message.
//
// Public by design (Twilio has no session); authenticated by signature.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']
const HELP_WORDS = ['HELP', 'INFO']

/**
 * Twilio signs the request with HMAC-SHA1 over the full URL plus every POST
 * field sorted by key. Fails closed when TWILIO_AUTH_TOKEN is unset.
 */
function verifySignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!token || !signature) return false

  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)

  const expected = createHmac('sha1', token).update(Buffer.from(payload, 'utf-8')).digest('base64')

  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}

function twiml(message: string): Response {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  )
}

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const params: Record<string, string> = {}
    form.forEach((value, key) => {
      params[key] = String(value)
    })

    if (!verifySignature(req.url, params, req.headers.get('x-twilio-signature'))) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const from = String(params.From || '').trim()
    const to = String(params.To || '').trim()
    const keyword = String(params.Body || '').trim().toUpperCase()

    // Which client owns the number that was messaged.
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, name, contact_email, contact_phone')
      .eq('bland_phone_number', to)
      .maybeSingle()

    const clientId = client?.id

    if (STOP_WORDS.includes(keyword)) {
      if (clientId && from) {
        await suppress(clientId, 'sms', from, 'stop')
        await supabaseAdmin
          .from('leads')
          .update({ phone_consent: false })
          .eq('client_id', clientId)
          .eq('phone', from)
      } else {
        console.warn('[twilio] STOP received for an unmapped number:', to)
      }
      return twiml('You have been unsubscribed and will receive no further messages.')
    }

    if (HELP_WORDS.includes(keyword)) {
      const name = client?.name || companyName()
      const contact = client?.contact_email || client?.contact_phone || ''
      return twiml(
        `${name}${contact ? ' — ' + contact : ''}. Reply STOP to opt out. Msg & data rates may apply.`,
      )
    }

    // Anything else: acknowledged silently, no auto-reply.
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (err) {
    console.error('[twilio] webhook failed:', err)
    return Response.json({ error: 'Webhook failed' }, { status: 500 })
  }
}
