import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { serverError } from '@/lib/server-error'

// GET /api/agents/scheduler/appointments?client_id=…&status=pending&from=…&to=…
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

    let query = supabaseAdmin
      .from('appointments')
      .select(
        'id, client_id, customer_name, customer_email, customer_phone, requested_date, requested_time, confirmed_date, confirmed_time, service_type, status, notes, reminder_sent, created_at, updated_at',
      )
      .eq('client_id', client_id)
      .order('requested_date', { ascending: true, nullsFirst: false })
      .order('requested_time', { ascending: true, nullsFirst: false });

    const status = searchParams.get('status');
    if (status) query = query.eq('status', status.toLowerCase().trim());

    const from = searchParams.get('from');
    if (from) query = query.gte('requested_date', from);

    const to = searchParams.get('to');
    if (to) query = query.lte('requested_date', to);

    const { data, error } = await query;

    if (error) {
      console.error('[scheduler/appointments] query failed:', error.message);
      return serverError(error, 'agents/scheduler/appointments');
    }

    const appointments = data || [];

    return NextResponse.json({
      client_id,
      total: appointments.length,
      by_status: appointments.reduce((acc: Record<string, number>, a: any) => {
        const key = a.status || 'pending';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      appointments,
    });
  } catch (err: any) {
    console.error('[scheduler/appointments] GET failed:', err);
    return serverError(err, 'agents/scheduler/appointments');
  }
}
