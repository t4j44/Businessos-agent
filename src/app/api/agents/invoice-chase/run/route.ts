import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runInvoiceChase } from '../route';
import { requireCronOrSession, authErrorResponse } from '@/lib/auth-guard';

// Batch entry point used by the Vercel cron (/api/cron/invoice-chase).
//
// The base POST /api/agents/invoice-chase chases exactly one invoice and needs
// customer_name, amount_cents, invoice_number and chase_step. The cron only
// knows the client, so this route does the fan-out: it finds which invoices are
// actually due a chase and advances each one a single step.

const MAX_CHASE_STEP = 5;

export async function POST(req: Request) {
  let clientId: string;
  let reqBody: any = {};
  try {
    reqBody = await req.json().catch(() => ({}));
    ({ clientId } = await requireCronOrSession(req, reqBody?.client_id));
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const client_id = clientId;

    if (!client_id) {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 });
    }

    const { data: rows, error } = await supabaseAdmin
      .from('invoices')
      .select('id, stripe_invoice_id, customer_name, customer_email, amount_cents, status, days_overdue, chase_step')
      .eq('client_id', client_id)
      .order('days_overdue', { ascending: false });

    if (error) {
      console.error('[invoice-chase/run] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Only chase what should be chased: unpaid, not paused, actually overdue,
    // and not already at the final notice.
    const chaseable = (rows || []).filter((inv: any) => {
      if (inv.status === 'paid' || inv.status === 'paused') return false;
      if ((Number(inv.days_overdue) || 0) <= 0) return false;
      return (Number(inv.chase_step) || 0) < MAX_CHASE_STEP;
    });

    const results: any[] = [];

    for (const inv of chaseable) {
      const nextStep = (Number(inv.chase_step) || 0) + 1;
      try {
        const { status, body } = await runInvoiceChase({
          client_id,
          customer_name: inv.customer_name || 'there',
          amount_due: (Number(inv.amount_cents) || 0) / 100,
          invoice_id: inv.stripe_invoice_id || String(inv.id).slice(0, 8),
          days_overdue: Number(inv.days_overdue) || 0,
          chase_step: nextStep as 1 | 2 | 3 | 4 | 5,
          // Without this the contact can never be resolved — a name alone is
          // not an identity.
          customer_email: inv.customer_email || undefined,
        });

        if (status === 200) {
          // Record the advance so tomorrow's run moves to the next step rather
          // than resending the same message.
          await supabaseAdmin
            .from('invoices')
            .update({ chase_step: nextStep, last_chase_at: new Date().toISOString() })
            .eq('id', inv.id);
        }

        results.push({
          invoice_id: inv.id,
          chase_step: nextStep,
          status: status === 200 ? 'ok' : 'failed',
          error: status === 200 ? undefined : body?.error,
        });
      } catch (err: any) {
        results.push({ invoice_id: inv.id, chase_step: nextStep, status: 'error', error: err?.message });
      }
    }

    return NextResponse.json({
      client_id,
      eligible: chaseable.length,
      chased: results.filter((r) => r.status === 'ok').length,
      results,
    });
  } catch (err: any) {
    console.error('[invoice-chase/run] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
