import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { readJsonBody, isUuid, ValidationError } from '@/lib/validation';

// PATCH { action: 'pause' | 'resume' | 'mark_paid' }
//
// There is no `paused` column on invoices, so pausing is represented by
// status = 'paused' and resuming returns the row to 'sent'.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { action } = await readJsonBody(req);
    if (!isUuid(id)) throw new ValidationError('Invalid invoice ID.');

    if (!['pause', 'resume', 'mark_paid'].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'pause', 'resume', or 'mark_paid'." },
        { status: 400 },
      );
    }

    const { data: existing, error: readError } = await supabaseAdmin.from('invoices')
      .select('id, status, paid_at, days_overdue').eq('client_id', clientId).eq('id', id).maybeSingle();
    if (readError) return NextResponse.json({ error: 'Invoice lookup is unavailable.' }, { status: 503 });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if ((action === 'mark_paid' && existing.status === 'paid') || (action === 'pause' && existing.status === 'paused')) {
      return NextResponse.json({ updated: false, invoice: existing });
    }
    const allowed = action === 'resume' ? ['paused'] : action === 'pause' ? ['sent', 'overdue'] : ['draft', 'sent', 'overdue', 'paused'];
    if (!allowed.includes(existing.status)) return NextResponse.json({ error: 'This action does not apply to the current invoice status.' }, { status: 409 });

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
      // Ownership: a row belonging to another tenant must be
      // indistinguishable from one that does not exist.
      .eq('client_id', clientId)
      .eq('status', existing.status)
      .select('id, status, paid_at, days_overdue')
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      console.error('[invoices/:id] update failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) return NextResponse.json({ error: 'Invoice changed. Refresh before trying again.' }, { status: 409 });
    return NextResponse.json({ updated: true, invoice: data });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[invoices/:id] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
