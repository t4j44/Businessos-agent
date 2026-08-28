import { timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { callAI, MODELS, parseJSON } from '@/lib/ai'
import { logAgentRun } from '@/lib/log'
import { findOrCreateContact, logInteraction, updateContactScore } from '@/lib/contacts'
import { TEST_CLIENT_ID } from '@/lib/client-config';
import { sendBrandedEmail, escapeHtml } from '@/lib/resend';


// Shared-secret check. Bland does not sign its webhooks, so the secret is read
// from either a header or a ?secret= query parameter.
//
// IMPORTANT: the URL registered in the Bland dashboard must carry the secret,
// e.g. https://<host>/api/webhooks/bland?secret=<BLAND_WEBHOOK_SECRET>
//
// Fails closed: with BLAND_WEBHOOK_SECRET unset, every request is rejected.
function blandAuthorised(req: Request): boolean {
  const expected = process.env.BLAND_WEBHOOK_SECRET
  if (!expected) return false

  const header =
    req.headers.get('x-bland-secret') ||
    req.headers.get('x-webhook-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer /, '')
  const query = new URL(req.url).searchParams.get('secret') || ''
  const provided = header || query
  if (!provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  if (!blandAuthorised(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const auth = req.headers.get('authorization')
  if (auth !== 'Bearer ' + process.env.BLAND_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json()
  const { call_id, from: callerNumber, call_length, transcript, metadata } = body
  const clientId = metadata?.client_id || TEST_CLIENT_ID

  const { data: existing } = await supabaseAdmin
    .from('call_transcripts').select('id')
    .eq('bland_call_id', call_id).single()
  if (existing) return Response.json({ received: true, skipped: 'duplicate' })

  let analysis = { summary: 'Call received', sentiment_score: 70,
    resolved: false, escalated: false, escalation_reason: null }

  if (transcript && transcript.length > 20) {
    try {
      const result = await callAI({
        model: MODELS.HAIKU,
        system: 'Analyze this phone call transcript. Return ONLY valid JSON: { "summary": string (2 sentences), "sentiment_score": number 0-100, "resolved": boolean, "escalated": boolean, "escalation_reason": string or null }',
        user: 'Transcript: ' + transcript,
        maxTokens: 400
      })
      analysis = parseJSON(result.text)
    } catch (e) { console.error('Analysis failed:', e) }
  }

  await supabaseAdmin.from('call_transcripts').insert({
    client_id: clientId,
    bland_call_id: call_id,
    caller_number: callerNumber || 'unknown',
    duration_sec: Math.round(call_length || 0),
    transcript: transcript || '',
    summary: analysis.summary,
    sentiment_score: analysis.sentiment_score,
    resolved: analysis.resolved,
    escalated: analysis.escalated,
    escalation_reason: analysis.escalation_reason,
    direction: 'inbound'
  })

  // Contact intelligence — resolve the caller and record the call on their
  // shared timeline. Name is left null rather than literal 'Caller' so a later
  // interaction that knows the real name can backfill it (find_or_create_contact
  // only fills fields that are still null).
  const contact = await findOrCreateContact({
    client_id: clientId,
    phone: callerNumber,
    source: 'call_center',
  })

  if (contact) {
    const scoreDelta = analysis.resolved ? 5 : analysis.escalated ? -10 : 0
    await logInteraction({
      contact_id: contact.id,
      client_id: clientId,
      agent_name: 'call_center',
      interaction_type: 'call',
      summary: analysis.summary,
      sentiment_score: analysis.sentiment_score,
      metadata: {
        outcome: analysis.escalated ? 'escalated' : analysis.resolved ? 'resolved' : 'no_resolution',
        duration_sec: Math.round(call_length || 0),
        escalation_reason: analysis.escalation_reason,
        transcript_preview: transcript?.slice(0, 300),
      },
    })
    if (scoreDelta) {
      await updateContactScore({ contact_id: contact.id, score_delta: scoreDelta })
    }
  }

  if (analysis.escalated) {
    try {
      const { data: client } = await supabaseAdmin
        .from('clients').select('contact_email, name')
        .eq('id', clientId).single()

      if (client?.contact_email) {
        const reason = analysis.escalation_reason || 'Escalation triggered'

        // Through sendBrandedEmail, not a bare Resend client. This is an
        // operational notice about the client's own account rather than
        // marketing, so transactional: true — it still carries the postal
        // address and honours the suppression list, but omits the marketing
        // unsubscribe copy.
        const result = await sendBrandedEmail({
          clientId,
          transactional: true,
          from_name: (client.name || 'Business OS') + ' Alerts',
          to: client.contact_email,
          subject: '🚨 Call needs your attention — ' + client.name,
          html:
            '<p>A call came in that needs human attention.</p>' +
            '<p><strong>Reason:</strong> ' + escapeHtml(reason) + '</p>' +
            '<p><strong>Summary:</strong> ' + escapeHtml(analysis.summary || '') + '</p>' +
            '<p>Log in to your dashboard to review the full transcript.</p>',
          text: [
            'A call came in that needs human attention.',
            '',
            'Reason: ' + reason,
            'Summary: ' + (analysis.summary || ''),
            '',
            'Log in to your dashboard to review the full transcript.',
          ].join('\n'),
        })

        if (!result.sent) {
          console.warn('[bland] escalation alert not sent:', result.skipped || result.error)
        }
      }
    } catch (e) { console.error('Alert email failed:', e) }
  }

  await logAgentRun({ client_id: clientId, agent_type: 'call_center_inbound',
    status: 'completed', output_summary: analysis.summary,
    metadata: { escalated: analysis.escalated, sentiment: analysis.sentiment_score } })

  return Response.json({ received: true })
}
