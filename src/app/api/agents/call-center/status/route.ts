import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

// GET /api/agents/call-center/status?client_id=…
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
    const connected = Boolean(process.env.BLAND_API_KEY);

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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      client_id,
      connected,
      provider: 'Bland AI',
      // What the UI should tell the operator to do when it is not connected.
      hint: connected ? null : 'Add BLAND_API_KEY to .env.local to connect your phone line.',
      recent_calls: data || [],
    });
  } catch (err: any) {
    console.error('[call-center/status] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
