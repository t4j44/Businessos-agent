import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { getSchedulerContext, sendConfirmationEmail, formatWhen } from '@/lib/appointments';
import type { SendEmailResult } from '@/lib/resend';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

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
    const body = await req.json();

    const appointment_id = body?.appointment_id;
    const confirmed_time = body?.confirmed_time;
    const confirmed_date = body?.confirmed_date;

    if (!appointment_id || !confirmed_time) {
      return NextResponse.json(
        { error: 'appointment_id and confirmed_time are required.' },
        { status: 400 },
      );
    }

    if (confirmed_date && Number.isNaN(new Date(`${confirmed_date}T00:00:00Z`).getTime())) {
      return NextResponse.json(
        { error: 'confirmed_date must be a valid date (YYYY-MM-DD).' },
        { status: 400 },
      );
    }

    const { data: existing, error: findError } = await supabaseAdmin
      .from('appointments')
      .select('id, client_id, customer_name, customer_email, requested_date, service_type, status')
      .eq('id', appointment_id)
      .maybeSingle();

    if (findError) {
      console.error('[scheduler/confirm] lookup failed:', findError.message);
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });
    }
    if (existing.status === 'cancelled') {
      return NextResponse.json(
        { error: 'This appointment was cancelled — it cannot be confirmed.' },
        { status: 409 },
      );
    }

    // Falls back to the requested day so the confirmation email always states a
    // full date rather than a bare time.
    const finalDate = confirmed_date || existing.requested_date;

    const { data: appointment, error } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'confirmed',
        confirmed_date: finalDate,
        confirmed_time,
        updated_at: new Date().toISOString(),
        // A change of time invalidates any reminder already sent.
        reminder_sent: false,
      })
      .eq('id', appointment_id)
      .select(
        'id, client_id, customer_name, customer_email, customer_phone, requested_date, requested_time, confirmed_date, confirmed_time, service_type, status, notes, created_at',
      )
      .single();

    if (error) {
      console.error('[scheduler/confirm] update failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Ownership: another tenant's appointment is indistinguishable
    // from one that does not exist.
    if (existing.client_id !== clientId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ctx = await getSchedulerContext(existing.client_id);

    const emailResult: SendEmailResult = appointment.customer_email
      ? await sendConfirmationEmail({
          ctx,
          customerName: appointment.customer_name,
          customerEmail: appointment.customer_email,
          confirmedDate: finalDate,
          confirmedTime: confirmed_time,
          serviceType: appointment.service_type,
        })
      : { sent: false, skipped: 'Appointment has no customer_email.' };

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
        email_issue: emailResult.error || emailResult.skipped || null,
      },
    });

    return NextResponse.json({ confirmed: true, appointment, email: emailResult });
  } catch (err: any) {
    console.error('[scheduler/confirm] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
