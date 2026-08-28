import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { TEST_CLIENT_ID } from '@/lib/client-config';
import { resolveClientId } from '@/lib/session';
const WINDOW_DAYS = 7;
const MS_DAY = 24 * 60 * 60 * 1000;

function avg(values: number[]): number {
  const nums = values.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// Strips the brief HTML down to its opening sentences.
function briefSummary(html: string): string {
  const text = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts) return text.slice(0, 240);
  return parts.slice(0, 2).join(' ').trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = (await resolveClientId(req)).clientId;
    const since = new Date(Date.now() - WINDOW_DAYS * MS_DAY).toISOString();

    // ── agent_runs ────────────────────────────────────────────────────────
    const { data: runRows } = await supabaseAdmin
      .from('agent_runs')
      .select('agent_type, cost_usd, status, output_summary, created_at')
      .eq('client_id', client_id)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    const runs = runRows || [];
    // `runs` is ordered created_at DESC, so the first row seen for a given
    // agent_type is that agent's most recent run — which is what the agent
    // cards on the dashboard show as last run time and status.
    const runTypeMap: Record<
      string,
      { count: number; cost: number; last_status: string | null; last_run_at: string | null }
    > = {};
    let totalCost = 0;
    for (const r of runs) {
      const key = r.agent_type || 'unknown';
      if (!runTypeMap[key]) {
        runTypeMap[key] = {
          count: 0,
          cost: 0,
          last_status: r.status ?? null,
          last_run_at: r.created_at ?? null,
        };
      }
      runTypeMap[key].count++;
      runTypeMap[key].cost += Number(r.cost_usd) || 0;
      totalCost += Number(r.cost_usd) || 0;
    }
    const runsByType = Object.entries(runTypeMap)
      .map(([type, v]) => ({
        type,
        count: v.count,
        cost: Number(v.cost.toFixed(6)),
        last_status: v.last_status,
        last_run_at: v.last_run_at,
      }))
      .sort((a, b) => b.count - a.count);

    // ── call_transcripts ──────────────────────────────────────────────────
    const { data: callRows } = await supabaseAdmin
      .from('call_transcripts')
      .select('resolved, escalated, sentiment_score, created_at')
      .eq('client_id', client_id)
      .gte('created_at', since);

    const calls = callRows || [];
    const callsResolved = calls.filter((c) => c.resolved === true).length;
    const callsEscalated = calls.filter((c) => c.escalated === true).length;

    const callsByDay = [];
    const now = new Date();
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * MS_DAY);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + MS_DAY);
      const inDay = calls.filter((c) => {
        const t = new Date(c.created_at).getTime();
        return t >= dayStart.getTime() && t < dayEnd.getTime();
      });
      callsByDay.push({
        day: dayStart.toLocaleDateString('en-US', { weekday: 'short' }),
        resolved: inDay.filter((c) => c.resolved === true).length,
        escalated: inDay.filter((c) => c.escalated === true).length,
      });
    }

    // ── reviews ───────────────────────────────────────────────────────────
    const { data: reviewRows } = await supabaseAdmin
      .from('reviews')
      .select('star_rating, responded')
      .eq('client_id', client_id)
      .gte('created_at', since);

    const reviews = reviewRows || [];
    const reviewsResponded = reviews.filter((r) => r.responded === true).length;
    const bySentiment = {
      positive: reviews.filter((r) => Number(r.star_rating) >= 4).length,
      neutral: reviews.filter((r) => Number(r.star_rating) === 3).length,
      negative: reviews.filter((r) => Number(r.star_rating) > 0 && Number(r.star_rating) <= 2).length,
    };

    // ── invoices ──────────────────────────────────────────────────────────
    const { data: invoiceRows } = await supabaseAdmin
      .from('invoices')
      .select('status, amount_cents, days_overdue, chase_step')
      .eq('client_id', client_id)
      .gte('created_at', since);

    const invoices = invoiceRows || [];
    const paidInvoices = invoices.filter((i) => i.status === 'paid');
    const overdueInvoices = invoices.filter(
      (i) => i.status === 'overdue' || (Number(i.days_overdue) || 0) > 0,
    );
    const sumCents = (rows: any[]) =>
      rows.reduce((total, i) => total + (Number(i.amount_cents) || 0), 0);

    // Chase steps 0-5 of the invoice-chase sequence.
    const byStage = Array.from({ length: 6 }).map((_, step) => ({
      step,
      count: invoices.filter((i) => (Number(i.chase_step) || 0) === step).length,
    }));

    // ── weekly_briefs (latest, not limited to the window) ─────────────────
    const { data: briefRows } = await supabaseAdmin
      .from('weekly_briefs')
      .select('id, brief_html, ware_score, week_start, created_at')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(1);

    const latestBrief = briefRows?.[0] || null;

    // ── approvals_queue ───────────────────────────────────────────────────
    const { data: approvalRows } = await supabaseAdmin
      .from('approvals_queue')
      .select('id, action_type, payload_json, created_at, expires_at')
      .eq('client_id', client_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    const approvals = approvalRows || [];

    // ── leads ─────────────────────────────────────────────────────────────
    const { data: leadRows } = await supabaseAdmin
      .from('leads')
      .select('id, name, company, bos_lead_score, status')
      .eq('client_id', client_id)
      .order('bos_lead_score', { ascending: false })
      .limit(5);

    const { data: leadWindowRows } = await supabaseAdmin
      .from('leads')
      .select('last_contacted_at')
      .eq('client_id', client_id)
      .gte('created_at', since);

    const leadsInWindow = leadWindowRows || [];

    // ── WARE score, computed live from this window's activity ─────────────
    const wareScore = Math.max(
      0,
      Math.min(
        1000,
        callsResolved * 10 + reviewsResponded * 15 + paidInvoices.length * 20 + runs.length * 2,
      ),
    );

    const payload = {
      client_id,
      window_days: WINDOW_DAYS,

      ware_score: wareScore,

      calls: {
        total: calls.length,
        resolved: callsResolved,
        escalated: callsEscalated,
        avg_sentiment: avg(calls.map((c) => Number(c.sentiment_score))),
        by_day: callsByDay,
      },

      reviews: {
        total: reviews.length,
        responded: reviewsResponded,
        avg_rating: avg(reviews.map((r) => Number(r.star_rating))),
        by_sentiment: bySentiment,
      },

      invoices: {
        total_sent: invoices.length,
        paid: paidInvoices.length,
        overdue: overdueInvoices.length,
        amount_collected_cents: sumCents(paidInvoices),
        by_stage: byStage,
        // Retained for existing callers.
        total_amount_cents: sumCents(invoices),
        paid_amount_cents: sumCents(paidInvoices),
      },

      agent_runs: {
        total: runs.length,
        by_type: runsByType,
        total_cost_usd: Number(totalCost.toFixed(6)),
        completed: runs.filter((r) => r.status === 'completed' || r.status === 'success').length,
        failed: runs.filter((r) => r.status === 'failed' || r.status === 'error').length,
        recent: runs.slice(0, 6).map((r) => ({
          agent_type: r.agent_type,
          status: r.status,
          output_summary: r.output_summary,
          created_at: r.created_at,
        })),
      },

      approvals: {
        pending_count: approvals.length,
        items: approvals,
        // Retained for existing callers.
        pending: approvals.length,
      },

      latest_brief: latestBrief
        ? {
            id: latestBrief.id,
            ware_score: latestBrief.ware_score,
            summary: briefSummary(latestBrief.brief_html),
            brief_html: latestBrief.brief_html,
            week_start: latestBrief.week_start,
          }
        : null,

      hot_leads: leadRows || [],
      leads: {
        total: leadsInWindow.length,
        contacted: leadsInWindow.filter((l) => !!l.last_contacted_at).length,
      },
    };

    // Drives the dashboard's empty state instead of a wall of zeros.
    const isEmpty =
      payload.agent_runs.total === 0 &&
      payload.calls.total === 0 &&
      payload.reviews.total === 0 &&
      payload.invoices.total_sent === 0 &&
      payload.approvals.pending_count === 0 &&
      !payload.latest_brief;

    return NextResponse.json({ ...payload, is_empty: isEmpty });
  } catch (err: any) {
    console.error('[dashboard/metrics] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
