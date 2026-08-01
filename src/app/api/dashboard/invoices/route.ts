import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

// The chase sequence has 5 steps, but the funnel presents Sent → 1..4 → Paid,
// so step 5 (final notice) is folded into the "Step 4 Call" stage.
export const STAGES = [
  { key: 'sent', label: 'Sent' },
  { key: 'step1', label: 'Step 1 Reminder' },
  { key: 'step2', label: 'Step 2 SMS' },
  { key: 'step3', label: 'Step 3 Firm Email' },
  { key: 'step4', label: 'Step 4 Call' },
  { key: 'paid', label: 'Paid' },
] as const;

function stageOf(inv: any): string {
  if (inv.status === 'paid') return 'paid';
  const step = Number(inv.chase_step) || 0;
  if (step >= 4) return 'step4';
  if (step === 3) return 'step3';
  if (step === 2) return 'step2';
  if (step === 1) return 'step1';
  return 'sent';
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = searchParams.get('client_id') || TEST_CLIENT_ID;

    const { data: rows, error } = await supabaseAdmin
      .from('invoices')
      .select(
        'id, customer_name, customer_email, amount_cents, status, days_overdue, chase_step, last_chase_at, paid_at, due_date, created_at',
      )
      .eq('client_id', client_id)
      .order('days_overdue', { ascending: false });

    if (error) {
      console.error('[dashboard/invoices] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const invoices = (rows || []).map((inv: any) => ({
      ...inv,
      amount_cents: Number(inv.amount_cents) || 0,
      days_overdue: Number(inv.days_overdue) || 0,
      chase_step: Number(inv.chase_step) || 0,
      stage: stageOf(inv),
      is_paid: inv.status === 'paid',
      is_paused: inv.status === 'paused',
    }));

    // Most overdue first.
    invoices.sort((a: any, b: any) => b.days_overdue - a.days_overdue);

    const unpaid = invoices.filter((i: any) => !i.is_paid);
    const paid = invoices.filter((i: any) => i.is_paid);

    const sum = (list: any[]) => list.reduce((t, i) => t + i.amount_cents, 0);

    // Collected in the current calendar month.
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const collectedThisMonth = paid.filter(
      (i: any) => i.paid_at && new Date(i.paid_at).getTime() >= monthStart.getTime(),
    );

    // Average days from creation to payment.
    const paidDurations = paid
      .filter((i: any) => i.paid_at && i.created_at)
      .map((i: any) =>
        Math.max(
          0,
          Math.round(
            (new Date(i.paid_at).getTime() - new Date(i.created_at).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        ),
      );
    const avgDaysToPayment = paidDurations.length
      ? Math.round(paidDurations.reduce((a, b) => a + b, 0) / paidDurations.length)
      : null;

    const funnel = STAGES.map((s) => {
      const list = invoices.filter((i: any) => i.stage === s.key);
      return {
        key: s.key,
        label: s.label,
        count: list.length,
        amount_cents: sum(list),
      };
    });

    // Invoices sitting at the final chase step and still unpaid.
    const finalStep = invoices.filter((i: any) => i.stage === 'step4' && !i.is_paid);

    return NextResponse.json({
      client_id,
      is_empty: invoices.length === 0,
      summary: {
        outstanding_cents: sum(unpaid),
        collected_this_month_cents: sum(collectedThisMonth),
        overdue_over_7_count: unpaid.filter((i: any) => i.days_overdue > 7).length,
        avg_days_to_payment: avgDaysToPayment,
        total_invoices: invoices.length,
      },
      funnel,
      quick_win: finalStep.length
        ? {
            count: finalStep.length,
            top_name: finalStep[0].customer_name,
            top_amount_cents: finalStep[0].amount_cents,
            total_amount_cents: sum(finalStep),
          }
        : null,
      invoices,
    });
  } catch (err: any) {
    console.error('[dashboard/invoices] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
