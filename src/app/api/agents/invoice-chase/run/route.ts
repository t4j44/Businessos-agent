import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runInvoiceChase } from '../route';
import { requireCronOrSession, authErrorResponse } from '@/lib/auth-guard';
import { serverError } from '@/lib/server-error'

// Batch entry point used by the Vercel cron (/api/cron/invoice-chase).
//
// The base POST /api/agents/invoice-chase chases exactly one invoice and needs
// customer_name, amount_cents, invoice_number and chase_step. The cron only
// knows the client, so this route does the fan-out: it finds which invoices are
// due for a draft. Delivery and step advancement are separate actions.

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
      return serverError(error, 'agents/invoice-chase/run');
    }

    const results: any[] = [];
    for (const inv of rows || []) {
      const { data: claim, error: claimError } = await supabaseAdmin.rpc('claim_invoice_draft', { p_client_id: client_id, p_invoice_id: inv.id });
      if (claimError) { results.push({ invoice_id: inv.id, status: 'failed' }); continue; }
      if (claim?.outcome !== 'claimed') { results.push({ invoice_id: inv.id, status: 'skipped', reason: claim?.outcome }); continue; }
      try {
        const { status, body } = await runInvoiceChase({
          client_id, customer_name: claim.invoice.customer_name || 'Customer',
          customer_email: claim.invoice.customer_email || undefined,
          amount_due: claim.invoice.amount_cents / 100,
          invoice_id: claim.invoice.stripe_invoice_id || String(inv.id).slice(0, 8),
          days_overdue: claim.days_overdue, chase_step: claim.chase_step,
        });
        if (status !== 200) throw new Error('Draft generation failed');
        const { data: saved, error } = await supabaseAdmin.from('invoice_chase_drafts')
          .update({ status: 'draft', message: body.message, channel: body.channel })
          .eq('client_id', client_id).eq('id', claim.draft_id).eq('generation_token', claim.generation_token).select('id');
        if (error || !saved?.length) throw new Error('Draft could not be saved');
        results.push({ invoice_id: inv.id, draft_id: claim.draft_id, status: 'drafted' });
      } catch {
        await supabaseAdmin.from('invoice_chase_drafts').update({ status: 'failed' })
          .eq('client_id', client_id).eq('id', claim.draft_id).eq('generation_token', claim.generation_token);
        results.push({ invoice_id: inv.id, status: 'failed' });
      }
    }
    // A draft does not advance the invoice, change its customer score, or send.
    return NextResponse.json({ client_id, eligible: results.filter(r => r.status !== 'skipped').length,
      drafted: results.filter(r => r.status === 'drafted').length, sent: 0, results });
  } catch (err: any) {
    console.error('[invoice-chase/run] POST failed:', err);
    return serverError(err, 'agents/invoice-chase/run');
  }
}
