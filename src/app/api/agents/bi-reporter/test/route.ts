import { NextResponse } from 'next/server';
import { runBiReporter } from '../route';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

const FAKE_METRICS = {
  calls: { total: 34, resolved: 19, escalated: 8, avg_sentiment: 61 },
  reviews: { total: 5, avg_rating: 4.5, responded: 2 },
  invoices: { total: 6, paid: 2, overdue: 4, sum_amount_due: 1500 },
  agent_runs: { total: 10, sum_cost_usd: 2.5 },
  contacts: { at_risk: 3 },
};

export async function GET() {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const { status, body } = await runBiReporter(TEST_CLIENT_ID, FAKE_METRICS);
    return NextResponse.json({
      status,
      success: body.success,
      brief_html: body.brief_html,
      ware_score: body.ware_score,
      metrics: body.metrics,
      saved_to_db: body.saved_to_db,
    });
  } catch (err: any) {
    console.error('[bi-reporter/test] failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
