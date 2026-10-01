import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { getBlandClient, normalizePhone } from '@/lib/bland';
import { serverError } from '@/lib/server-error'

// GET /api/agents/call-center/status?limit=…
//
// The tenant comes from the session; any client_id in the query string is
// ignored.
//
// Two things the calls screen cannot work out on its own:
//   1. whether the telephony provider is configured — BLAND_AI_KEY is a server
//      secret, so the browser can only be told present/absent, never the value;
//   2. the client's most recent calls.
export async function GET(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const client_id = clientId;

    if (!client_id) {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 });
    }

    const limitParam = Number(searchParams.get('limit'));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 5;

    // Presence only. The key itself never crosses the network boundary.
    const configured = Boolean(process.env.BLAND_API_KEY && process.env.BLAND_WEBHOOK_SECRET);
    const { data: voiceAgents, error: configError } = await supabaseAdmin.from('voice_agents')
      .select('id, phone_number, status, verified_at, last_verified_call_at').eq('client_id', client_id);
    let connected = false;
    let providerError: string | null = null;
    if (configured && !configError && voiceAgents?.length) {
      try {
        const numbers = await getBlandClient().listInboundNumbers();
        connected = voiceAgents.some((agent) => agent.verified_at && agent.last_verified_call_at && agent.status === 'live'
          && numbers.some((number) => normalizePhone(number.phone_number) === agent.phone_number));
      } catch { providerError = 'Voice provider could not be reached.'; }
    }

    const { data, error } = await supabaseAdmin
      .from('call_transcripts')
      .select(
        'id, direction, caller_number, duration_sec, summary, transcript, sentiment_score, resolved, escalated, escalation_reason, created_at',
      )
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[call-center/status] query failed:', error.message);
      return serverError(error, 'agents/call-center/status');
    }

    return NextResponse.json({
      client_id,
      connected,
      configured,
      state: connected ? 'live' : configError ? 'setup_required' : providerError ? 'error' : 'not_live',
      voice_agents: voiceAgents || [],
      provider: 'Bland AI',
      // What the UI should tell the operator to do when it is not connected.
      hint: connected ? 'Provider number and a signed inbound call are verified. Call quality still needs owner review.' : providerError || 'Configure provider credentials and a verified inbound-number mapping, then complete a test call and activate the phone line.',
      recent_calls: data || [],
    });
  } catch (err: any) {
    console.error('[call-center/status] GET failed:', err);
    return serverError(err, 'agents/call-center/status');
  }
}
