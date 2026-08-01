import { NextResponse } from 'next/server';
import { runBiReporter } from '../route';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

// Deliberately mixed: 56% call resolution rate is BELOW the 65% target,
// so the brief's "What's Not Working" section must call this out.
const FAKE_METRICS = {
  calls_handled: 34,
  calls_resolved: 19,
  calls_escalated: 8,
  avg_sentiment: 61,
  reviews_total: 5,
  reviews_responded: 2,
  invoices_sent: 6,
  invoices_paid: 2,
  invoices_overdue: 4,
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
      brief_html: body.brief_html,
      has_negative_section: body.has_negative_section,
      ware_score: body.ware_score,
      summary: body.summary,
    });
  } catch (err: any) {
    console.error('[bi-reporter/test] failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
