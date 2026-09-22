import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { beginAgentRun, AgentRuntimeError } from '@/lib/agent-runtime';
import { readJsonBody, isUuid, ValidationError } from '@/lib/validation';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  let run: Awaited<ReturnType<typeof beginAgentRun>> | undefined;
  try {
    const body = await readJsonBody(req, 8000);
    if (!isUuid(body.client_id) || !isUuid(body.request_key) || typeof body.session_id !== 'string'
      || !/^[a-f0-9-]{32,64}$/i.test(body.session_id)) throw new ValidationError('A valid business, session and request key are required.');
    const field = (key: string, max: number) => {
      const value = body[key] ?? '';
      if (typeof value !== 'string' || value.length > max) throw new ValidationError(`Invalid ${key}.`);
      return value.trim();
    };
    const name = field('name', 100), email = field('email', 254).toLowerCase(), phone = field('phone', 16), reason = field('reason', 1000);
    if (!reason || (!email && !phone)) throw new ValidationError('Add your question and an email or phone number for the team.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Enter a valid email.');
    if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new ValidationError('Use a phone number with country code, such as +14155550123.');
    const sessionKey = createHash('sha256').update(body.session_id).digest('hex');
    // Human help stays available when AI replies are paused or unconfigured.
    // It has its own durable spam limit and never calls an AI/email provider.
    run = await beginAgentRun({ clientId: body.client_id, agent: 'website_handoff', action: 'draft', subject: sessionKey,
      hourlyLimit: 100, subjectLimit: 5, reserveTokens: 0 });
    const { data, error } = await supabaseAdmin.rpc('request_widget_handoff', {
      p_client_id: body.client_id, p_session_key: sessionKey, p_request_key: body.request_key,
      p_fingerprint: createHash('sha256').update(JSON.stringify({ name, email, phone, reason })).digest('hex'),
      p_name: name, p_email: email, p_phone: phone, p_reason: reason,
    });
    if (error || !data) throw new AgentRuntimeError('Your request could not be saved. Please contact the business directly.', 503);
    if (data.outcome === 'conflict') throw new ValidationError('Request details changed. Please submit a new request.', 409);
    if (data.outcome === 'inactive') throw new AgentRuntimeError('This business is not accepting requests here.', 403);
    if (!['requested','unchanged','pending'].includes(data.outcome)) throw new AgentRuntimeError('Your request could not be saved.', 503);
    await run.finish('completed', 'Website request saved in owner inbox', { metadata: { conversation_id: data.id, notification_sent: false } });
    return NextResponse.json({ saved: true, notification_sent: false, status: data.status,
      message: data.status === 'resolved' ? 'The team marked this request resolved. Submit a new request if you still need help.'
        : 'Your request is in the team’s inbox. This is not live chat; contact the business directly for urgent help.' }, { headers: CORS });
  } catch (error) {
    await run?.finish('error', 'Website handoff request could not be saved');
    const known = error instanceof ValidationError || error instanceof AgentRuntimeError;
    const status = known ? error.status : 503;
    return NextResponse.json({ error: known ? error.message : 'Your request could not be saved.' },
      { status, headers: { ...CORS, ...(status === 429 ? { 'Retry-After': '3600' } : {}) } });
  }
}
