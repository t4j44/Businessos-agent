import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import {
  getSchedulerContext,
  sendRequestReceivedEmail,
  sendClientAlertEmail,
  formatWhen,
} from '@/lib/appointments';
import type { SendEmailResult } from '@/lib/resend';
import { requireSession, authErrorResponse } from '@/lib/auth-guard'

// POST /api/agents/scheduler/request
//
// Takes a booking request off the client's website, records it as pending, then
// tells both sides: the customer that it landed, the business that it needs
// confirming.
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
    const customer_name = body?.customer_name;
    const customer_email = body?.customer_email;
    const customer_phone = body?.customer_phone;
    const requested_date = body?.requested_date;
    const requested_time = body?.requested_time;
    const service_type = body?.service_type;
    const notes = body?.notes;

    if (!client_id || !customer_name || !requested_date) {
      return NextResponse.json(
        { error: 'client_id, customer_name, and requested_date are required.' },
        { status: 400 },
      );
    }

    // Without one of these the request can never be answered, and a booking
    // nobody can reply to is worse than a rejected form.
    if (!customer_email && !customer_phone) {
      return NextResponse.json(
        { error: 'Either customer_email or customer_phone is required so we can reach the customer.' },
        { status: 400 },
      );
    }

    // requested_date is a DATE column; a malformed value would fail the insert
    // with a Postgres error the website form cannot interpret.
    if (Number.isNaN(new Date(`${requested_date}T00:00:00Z`).getTime())) {
      return NextResponse.json(
        { error: 'requested_date must be a valid date (YYYY-MM-DD).' },
        { status: 400 },
      );
    }

    const { data: appointment, error } = await supabaseAdmin
      .from('appointments')
      .insert({
        client_id,
        customer_name,
        customer_email: customer_email || null,
        customer_phone: customer_phone || null,
        requested_date,
        requested_time: requested_time || null,
        service_type: service_type || null,
        notes: notes || null,
        status: 'pending',
      })
      .select(
        'id, client_id, customer_name, customer_email, customer_phone, requested_date, requested_time, service_type, status, notes, created_at',
      )
      .single();

    if (error) {
      console.error('[scheduler/request] insert failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const ctx = await getSchedulerContext(client_id);

    // Both emails are attempted regardless of whether the other succeeds — a
    // bounced customer receipt must not stop the business being told.
    const [customerResult, clientResult] = await Promise.all([
      customer_email
        ? sendRequestReceivedEmail({
            ctx,
            customerName: customer_name,
            customerEmail: customer_email,
            requestedDate: requested_date,
            requestedTime: requested_time,
            serviceType: service_type,
          })
        : Promise.resolve<SendEmailResult>({ sent: false, skipped: 'No customer_email provided.' }),
      sendClientAlertEmail({
        ctx,
        customerName: customer_name,
        customerEmail: customer_email,
        customerPhone: customer_phone,
        requestedDate: requested_date,
        requestedTime: requested_time,
        serviceType: service_type,
        notes,
      }),
    ]);

    await logAgentRun({
      client_id,
      agent_type: 'scheduler',
      status: 'completed',
      output_summary: `Appointment request from ${customer_name} for ${formatWhen(requested_date, requested_time)}`,
      metadata: {
        step: 'request',
        appointment_id: appointment.id,
        service_type: service_type || null,
        customer_notified: customerResult.sent,
        client_notified: clientResult.sent,
        email_issues: [customerResult, clientResult]
          .map((r) => r.error || r.skipped)
          .filter(Boolean),
      },
    });

    // The appointment is saved either way. Email outcomes are reported rather
    // than thrown so the form does not retry and create a duplicate booking.
    return NextResponse.json(
      {
        created: true,
        appointment,
        emails: { customer: customerResult, client: clientResult },
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error('[scheduler/request] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
