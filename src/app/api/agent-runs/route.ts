import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { TEST_CLIENT_ID } from '@/lib/client-config';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

// GET /api/agent-runs?client_id=…&limit=…
//
// The newest agent runs for one client, feeding the dashboard's live activity
// feed. This is deliberately a thin read: /api/dashboard/metrics aggregates
// runs into counts and per-type rollups, whereas the feed wants the raw rows
// in the order they happened.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

    const requested = Number(searchParams.get('limit'));
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const { data, error } = await supabaseAdmin
      .from('agent_runs')
      .select('id, agent_type, status, output_summary, cost_usd, created_at')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[agent-runs] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const runs = data || [];

    return NextResponse.json(
      {
        client_id,
        total: runs.length,
        runs,
      },
      {
        // The feed polls this every 10s; caching it would serve each poll the
        // same stale page and defeat the point.
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (err: any) {
    console.error('[agent-runs] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
