import { supabaseAdmin } from '@/lib/supabase'
import { verifyBlandSignature, normalizePhone } from '@/lib/bland'
import { logAgentRun } from '@/lib/log'

export async function handleVoiceWebhook(req: Request) {
  if (!process.env.BLAND_WEBHOOK_SECRET) return Response.json({ error: 'Webhook is not configured.' }, { status: 503 })
  if (!req.headers.get('x-webhook-signature')) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const reader = req.body?.getReader()
  if (!reader) return Response.json({ error: 'Empty webhook.' }, { status: 400 })
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 524288) { await reader.cancel(); return Response.json({ error: 'Payload too large.' }, { status: 413 }) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const rawBody = Buffer.concat(chunks).toString('utf8')
  if (!verifyBlandSignature(rawBody, req.headers.get('x-webhook-signature'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: Record<string, any>
  try { body = JSON.parse(rawBody) } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid event.' }, { status: 400 })
  const destination = normalizePhone(body.to)
  const caller = normalizePhone(body.from)
  if (typeof body.call_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.call_id) || !destination || body.inbound === false) {
    return Response.json({ error: 'An inbound call ID and destination number are required.' }, { status: 400 })
  }
  const minutes = Number(body.call_length ?? 0)
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return Response.json({ error: 'Invalid duration.' }, { status: 400 })
  const transcript = typeof body.concatenated_transcript === 'string' ? body.concatenated_transcript
    : typeof body.transcript === 'string' ? body.transcript : ''
  try {
    // Metadata, caller ID, and demo defaults never determine tenant identity.
    const { data: voiceAgent, error: mappingError } = await supabaseAdmin.from('voice_agents')
      .select('id, client_id, verified_at').eq('phone_number', destination).maybeSingle()
    if (mappingError) return Response.json({ error: 'Voice configuration unavailable.' }, { status: 503 })
    if (!voiceAgent?.verified_at) return Response.json({ error: 'Unregistered inbound number.' }, { status: 403 })
    // A previously active call may finish after pause. Save it regardless.
    const { data: result, error } = await supabaseAdmin.rpc('ingest_voice_call', {
      p_client_id: voiceAgent.client_id, p_voice_agent_id: voiceAgent.id,
      p_call_id: body.call_id, p_caller: caller, p_duration_sec: Math.round(minutes * 60),
      p_transcript: transcript.slice(0, 100000),
    })
    if (error || !result) return Response.json({ error: 'Call could not be saved. Retry this event.' }, { status: 503 })
    if (result.created) await logAgentRun({ client_id: voiceAgent.client_id, agent_type: 'call_center_inbound',
      status: 'completed', output_summary: 'Inbound call saved; analysis pending',
      metadata: { call_id: body.call_id, duration_sec: Math.round(minutes * 60), analysis_status: 'pending' } })
    return Response.json({ received: true, duplicate: !result.created })
  } catch {
    return Response.json({ error: 'Call ingestion is temporarily unavailable.' }, { status: 503 })
  }
}
