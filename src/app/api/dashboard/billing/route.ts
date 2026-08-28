import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { TEST_CLIENT_ID } from '@/lib/client-config';
import { requireSession, authErrorResponse } from '@/lib/auth-guard'

// Mirrors src/app/pricing/page.tsx.
const PLAN_PRICING: Record<string, number> = {
  starter: 97,
  core: 197,
  growth: 397,
  scale: 797,
  agency: 1997,
};

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

    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, plan_tier, status, stripe_customer_id, created_at')
      .eq('id', client_id)
      .maybeSingle();

    if (error) {
      console.error('[dashboard/billing] client query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const planTier = (client.plan_tier || 'starter').toLowerCase();

    // ── Token / cost usage ───────────────────────────────────────────────────
    const { data: usage } = await supabaseAdmin
      .from('api_usage')
      .select('tokens_used, token_limit, cost_usd')
      .eq('client_id', client_id)
      .maybeSingle();

    // ── Real agent spend this month, straight from agent_runs ────────────────
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { data: runRows } = await supabaseAdmin
      .from('agent_runs')
      .select('cost_usd')
      .eq('client_id', client_id)
      .gte('created_at', monthStart.toISOString());

    const runCostUsd = (runRows || []).reduce((t, r: any) => t + (Number(r.cost_usd) || 0), 0);

    // ── Leads and calls consumed, for the usage meters ───────────────────────
    const [{ count: leadCount }, { count: callCount }] = await Promise.all([
      supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client_id),
      supabaseAdmin
        .from('call_transcripts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client_id),
    ]);

    const { data: callRows } = await supabaseAdmin
      .from('call_transcripts')
      .select('duration_sec')
      .eq('client_id', client_id)
      .gte('created_at', monthStart.toISOString());

    const voiceMinutes = Math.round(
      (callRows || []).reduce((t, c: any) => t + (Number(c.duration_sec) || 0), 0) / 60,
    );

    return NextResponse.json({
      client_id,
      plan: {
        tier: planTier,
        label: planTier.charAt(0).toUpperCase() + planTier.slice(1),
        price_monthly: PLAN_PRICING[planTier] ?? null,
        status: client.status,
        // No Stripe customer means nothing has ever been billed.
        billing_connected: !!client.stripe_customer_id,
        member_since: client.created_at,
      },
      usage: {
        leads_total: leadCount ?? 0,
        calls_total: callCount ?? 0,
        voice_minutes_this_month: voiceMinutes,
        tokens_used: usage?.tokens_used ?? 0,
        token_limit: usage?.token_limit ?? null,
        // Recorded spend beats the api_usage rollup when the rollup is missing.
        cost_usd_this_month: Number(runCostUsd.toFixed(4)),
        cost_usd_lifetime: usage?.cost_usd != null ? Number(usage.cost_usd) : null,
      },
    });
  } catch (err: any) {
    console.error('[dashboard/billing] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
