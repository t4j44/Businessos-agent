import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
const DAYS = 7;
const MS_DAY = 24 * 60 * 60 * 1000;

export type Outcome = 'resolved' | 'escalated' | 'missed';

// A call that was neither resolved nor escalated was effectively dropped.
function outcomeOf(row: any): Outcome {
  if (row.escalated) return 'escalated';
  if (row.resolved) return 'resolved';
  return 'missed';
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = searchParams.get('client_id') || TEST_CLIENT_ID;

    const { data: rows, error } = await supabaseAdmin
      .from('call_transcripts')
      .select(
        'id, direction, caller_number, duration_sec, transcript, summary, sentiment_score, resolved, escalated, escalation_reason, created_at',
      )
      .eq('client_id', client_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[call-center/analyze] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const calls = (rows || []).map((r) => ({
      id: r.id,
      direction: r.direction,
      caller_number: r.caller_number,
      duration_sec: r.duration_sec,
      summary: r.summary,
      transcript: r.transcript,
      sentiment_score: r.sentiment_score,
      escalation_reason: r.escalation_reason,
      outcome: outcomeOf(r),
      created_at: r.created_at,
    }));

    const outcomes = {
      resolved: calls.filter((c) => c.outcome === 'resolved').length,
      escalated: calls.filter((c) => c.outcome === 'escalated').length,
      missed: calls.filter((c) => c.outcome === 'missed').length,
    };

    // duration_sec is frequently unset, so report whether any real data exists
    // rather than presenting an average of nothing as "0 sec".
    const durations = calls
      .map((c) => Number(c.duration_sec))
      .filter((n) => Number.isFinite(n) && n > 0);
    const avgDuration = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;

    // Demos booked comes from the bookings table, not the call rows.
    let demosBooked = 0;
    const { count: bookingCount, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .gte('created_at', new Date(Date.now() - DAYS * MS_DAY).toISOString());
    if (!bookingError) demosBooked = bookingCount || 0;

    // ── Last 7 days, stacked by outcome ──────────────────────────────────
    const byDay = [];
    const now = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * MS_DAY);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + MS_DAY);
      const inDay = calls.filter((c) => {
        const t = new Date(c.created_at).getTime();
        return t >= dayStart.getTime() && t < dayEnd.getTime();
      });
      byDay.push({
        day: dayStart.toLocaleDateString('en-US', { weekday: 'short' }),
        date: dayStart.toISOString().slice(0, 10),
        resolved: inDay.filter((c) => c.outcome === 'resolved').length,
        escalated: inDay.filter((c) => c.outcome === 'escalated').length,
        missed: inDay.filter((c) => c.outcome === 'missed').length,
      });
    }

    return NextResponse.json({
      client_id,
      summary: {
        total_calls: calls.length,
        demos_booked: demosBooked,
        missed_calls: outcomes.missed,
        avg_duration_sec: avgDuration,
        has_duration_data: durations.length > 0,
      },
      outcomes,
      by_day: byDay,
      calls,
      escalated_calls: calls.filter((c) => c.outcome === 'escalated'),
    });
  } catch (err: any) {
    console.error('[call-center/analyze] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
