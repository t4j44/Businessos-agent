import { NextResponse } from 'next/server';
import { createInvoice } from '@/lib/invoices';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard'

// POST /api/invoices — log a new invoice.
//
// Creation goes through lib/invoices.createInvoice, which writes the row and
// then sends the first-touch invoice email. The overdue chase ladder
// (/api/agents/invoice-chase) picks the invoice up separately once
// days_overdue goes positive.
export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();

    const client_id = clientId;
    const customer_email = body.customer_email;
    const amount_cents =
      body.amount_cents ?? (body.amount != null ? Math.round(Number(body.amount) * 100) : null);

    if (!client_id || !customer_email || amount_cents == null) {
      return NextResponse.json(
        { error: 'client_id, customer_email, and amount_cents (or amount) are required.' },
        { status: 400 },
      );
    }

    if (!Number.isFinite(Number(amount_cents)) || Number(amount_cents) <= 0) {
      return NextResponse.json(
        { error: 'amount_cents must be a positive number.' },
        { status: 400 },
      );
    }

    const { invoice, email } = await createInvoice({
      client_id,
      customer_email,
      customer_name: body.customer_name,
      amount_cents: Number(amount_cents),
      due_date: body.due_date,
      stripe_invoice_id: body.stripe_invoice_id ?? body.invoice_number,
      contact_id: body.contact_id,
      payment_url: body.payment_url,
      send_email: body.send_email !== false,
    });

    // The invoice exists either way — a bounced email is reported, not thrown,
    // so the caller does not retry the insert and duplicate the row.
    return NextResponse.json({ created: true, invoice, email }, { status: 201 });
  } catch (err: any) {
    console.error('[invoices] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

// GET /api/invoices?client_id=…&limit=…
//
// Plain list of a client's invoices, newest first. The dashboard's invoice
// screen uses this to show what has been logged; /api/dashboard/invoices is a
// different thing — it returns the aggregated funnel, not the raw rows.
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
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

    let query = supabaseAdmin
      .from('invoices')
      .select(
        'id, client_id, customer_name, customer_email, amount_cents, due_date, status, chase_step, days_overdue, created_at',
      )
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    const status = searchParams.get('status');
    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) {
      console.error('[invoices] GET failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const invoices = data || [];

    return NextResponse.json({
      client_id,
      total: invoices.length,
      total_amount_cents: invoices.reduce((sum, i) => sum + (Number(i.amount_cents) || 0), 0),
      invoices,
    });
  } catch (err: any) {
    console.error('[invoices] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
