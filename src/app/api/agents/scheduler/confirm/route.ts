import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { formatWhen } from '@/lib/appointments';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { isDate, isUuid, normalizeTime, readJsonBody, ValidationError } from '@/lib/validation';
import { serverError } from '@/lib/server-error'

// POST /api/agents/scheduler/confirm
//
// { appointment_id, confirmed_time, confirmed_date? }
//
// confirmed_date is optional — most confirmations keep the requested day and
// only pin down the time.
export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await readJsonBody(req);

    const appointment_id = body?.appointment_id;
    const confirmed_time = normalizeTime(body?.confirmed_time);
    const confirmed_date = body?.confirmed_date;

    if (!isUuid(appointment_id) || !confirmed_time) {
      return NextResponse.json(
        { error: 'A valid appointment_id and an exact confirmed_time (HH:MM) are required.' },
        { status: 400 },
      );
    }

    if (confirmed_date !== undefined && !isDate(confirmed_date)) {
      return NextResponse.json(
        { error: 'confirmed_date must be a valid date (YYYY-MM-DD).' },
        { status: 400 },
      );
    }

    const { data: existing, error: findError } = await supabaseAdmin
      .from('appointments')
      .select('id, client_id, customer_name, customer_email, requested_date, service_type, status')
      .eq('id', appointment_id)
      .eq('client_id', clientId)
      .maybeSingle();

    if (findError) {
      console.error('[scheduler/confirm] lookup failed:', findError.message);
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }
    if (!existing || existing.client_id !== clientId) {
      return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });
    }
    if (existing.status === 'cancelled' || existing.status === 'completed') {
      return NextResponse.json(
        { error: 'This appointment was cancelled — it cannot be confirmed.' },
        { status: 409 },
      );
    }

    // Falls back to the requested day so the confirmation email always states a
    // full date rather than a bare time.
    const finalDate = confirmed_date || existing.requested_date;
    if (!isDate(finalDate)) {
      return NextResponse.json({ error: 'An exact confirmed_date is required.' }, { status: 400 });
    }
    const duration = body.duration_minutes ?? 30;
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      return NextResponse.json({ error: 'duration_minutes must be between 5 and 480.' }, { status: 400 });
    }

    // The database serializes confirmations within this business's calendar.
    // Ownership, terminal state and overlap are checked again under the lock.
    const { data: result, error } = await supabaseAdmin.rpc('confirm_appointment', {
      p_client_id: clientId,
      p_appointment_id: appointment_id,
      p_date: finalDate,
      p_time: confirmed_time,
      p_duration_minutes: duration,
    });

    if (error) {
      console.error('[scheduler/confirm] update failed:', error.message);
      return NextResponse.json({ error: 'Confirmation could not be saved. No confirmation email was sent.' }, { status: 503 });
    }

    if (result?.outcome === 'not_found') return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });
    if (result?.outcome === 'conflict') return NextResponse.json({ error: 'This time overlaps another confirmed appointment.' }, { status: 409 });
    if (result?.outcome === 'invalid_state') return NextResponse.json({ error: 'A cancelled or completed appointment cannot be confirmed.' }, { status: 409 });
    if (!['confirmed', 'unchanged'].includes(result?.outcome) || !result?.appointment) {
      return NextResponse.json({ error: 'Confirmation was not completed.' }, { status: 503 });
    }
    const appointment = result.appointment;
    if (result.outcome === 'unchanged') {
      return NextResponse.json({ confirmed: true, appointment, unchanged: true, email: { sent: false, skipped: 'Already confirmed; notification not repeated.' } });
    }

    const emailResult = { sent: false, queued: Boolean(appointment.customer_email) };

    await logAgentRun({
      client_id: existing.client_id,
      agent_type: 'scheduler',
      status: 'completed',
      output_summary: `Confirmed ${appointment.customer_name || 'an appointment'} for ${formatWhen(finalDate, confirmed_time)}`,
      metadata: {
        step: 'confirm',
        appointment_id,
        confirmed_date: finalDate,
        confirmed_time,
        customer_notified: emailResult.sent,
        notification_queued: emailResult.queued,
      },
    });

    return NextResponse.json({ confirmed: true, appointment, email: emailResult });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[scheduler/confirm] POST failed:', err);
    return serverError(err, 'agents/scheduler/confirm');
  }
}
