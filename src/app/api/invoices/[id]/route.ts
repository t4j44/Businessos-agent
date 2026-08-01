import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// PATCH { action: 'pause' | 'resume' | 'mark_paid' }
//
// There is no `paused` column on invoices, so pausing is represented by
// status = 'paused' and resuming returns the row to 'sent'.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action } = await req.json();

    if (!['pause', 'resume', 'mark_paid'].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'pause', 'resume', or 'mark_paid'." },
        { status: 400 },
      );
    }

    if (String(id).startsWith('sample-')) {
      return NextResponse.json(
        { error: 'This is sample data — connect real invoices to take action.' },
        { status: 400 },
      );
    }

    const patch: Record<string, any> =
      action === 'mark_paid'
        ? { status: 'paid', paid_at: new Date().toISOString(), days_overdue: 0 }
        : action === 'pause'
          ? { status: 'paused' }
          : { status: 'sent' };

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .update(patch)
      .eq('id', id)
      .select('id, status, paid_at, days_overdue')
      .single();

    if (error) {
      console.error('[invoices/:id] update failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ updated: true, invoice: data });
  } catch (err: any) {
    console.error('[invoices/:id] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
