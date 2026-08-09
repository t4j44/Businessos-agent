import { supabaseAdmin } from '@/lib/supabase'
import { callAI, MODELS, parseJSON } from '@/lib/ai'
import { logAgentRun } from '@/lib/log'
import { findOrCreateContact, logInteraction, updateContactScore } from '@/lib/contacts'

export async function POST(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== 'Bearer ' + process.env.BLAND_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json()
  const { call_id, from: callerNumber, call_length, transcript, metadata } = body
  const clientId = metadata?.client_id || '00000000-0000-0000-0000-000000000001'

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

  if (analysis.escalated && process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const { data: client } = await supabaseAdmin
        .from('clients').select('contact_email, name')
        .eq('id', clientId).single()
      if (client?.contact_email) {
        await resend.emails.send({
          from: 'Business OS Alerts <alerts@businessos.ai>',
          to: client.contact_email,
          subject: '🚨 Call needs your attention — ' + client.name,
          html: '<p>A call came in that needs human attention.</p>' +
                '<p><strong>Reason:</strong> ' + (analysis.escalation_reason || 'Escalation triggered') + '</p>' +
                '<p><strong>Summary:</strong> ' + analysis.summary + '</p>' +
                '<p>Log in to your dashboard to review the full transcript.</p>'
        })
      }
    } catch (e) { console.error('Alert email failed:', e) }
  }

  await logAgentRun({ client_id: clientId, agent_type: 'call_center_inbound',
    status: 'completed', output_summary: analysis.summary,
    metadata: { escalated: analysis.escalated, sentiment: analysis.sentiment_score } })

  return Response.json({ received: true })
}
