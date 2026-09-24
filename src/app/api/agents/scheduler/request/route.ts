import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createHash } from 'node:crypto';
import { isDate, isUuid, readJsonBody, ValidationError } from '@/lib/validation';
import { normalizePhone } from '@/lib/bland';
import { logAgentRun } from '@/lib/log';
import { formatWhen } from '@/lib/appointments';
import { requireSession, authErrorResponse } from '@/lib/auth-guard'

// POST /api/agents/scheduler/request
//
// Authenticated owner intake; saves the request and durable notification jobs.
export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await readJsonBody(req);

    const client_id = clientId;
    const text = (value: unknown, max: number) => {
      if (value == null || value === '') return null;
      if (typeof value !== 'string' || value.length > max) throw new ValidationError(`Text fields must be at most ${max} characters.`);
      return value.trim() || null;
    };
    const customer_name = text(body.customer_name,200);
    const customer_email = text(body.customer_email,254)?.toLowerCase() || null;
    const rawPhone = text(body.customer_phone,40);
    const customer_phone = rawPhone ? normalizePhone(rawPhone) : null;
    const requested_date = body.requested_date;
    const requested_time = text(body.requested_time,80);
    const service_type = text(body.service_type,200);
    const notes = text(body.notes,2000);
    const key = req.headers.get('idempotency-key') || body.request_key;
    if (!isUuid(key)) throw new ValidationError('A request_key UUID is required to make retries safe.');
    if (!customer_name || !isDate(requested_date)) throw new ValidationError('A customer name and valid date (YYYY-MM-DD) are required.');
    if (customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) throw new ValidationError('Enter a valid email address.');
    if (rawPhone && !customer_phone) throw new ValidationError('Phone numbers must include a country code, for example +12025550100.');
    if (!customer_email && !customer_phone) throw new ValidationError('An email address or phone number is required.');
    const payload = { customer_name,customer_email,customer_phone,requested_date,requested_time,service_type,notes };
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const { data: result, error } = await supabaseAdmin.rpc('request_appointment', {
      p_client_id:client_id,p_key:key,p_fingerprint:fingerprint,p_payload:payload,
    });
    if (error || !result) return NextResponse.json({ error:'Booking request could not be saved.' },{status:503});
    if (result.outcome === 'conflict') return NextResponse.json({ error:'This request key was already used with different details.' },{status:409});
    if (result.outcome === 'identity_conflict') return NextResponse.json({ error:'The email and phone match different customer records. Resolve the identity before booking.' },{status:409});
    const appointment = result.appointment;
    if (result.outcome === 'unchanged') return NextResponse.json({ created:false,unchanged:true,appointment,
      emails:{customer:{sent:false,skipped:'Existing request; notifications not repeated.'},client:{sent:false,skipped:'Existing request; notifications not repeated.'}} });
    if (!appointment) return NextResponse.json({ error:'Booking request could not be saved.' },{status:503});

    // Migration 036 queues both notifications in the booking transaction.
    // Sending happens through the leased delivery worker, never inside intake.
    const customerResult = { sent: false, queued: Boolean(customer_email) };
    const clientResult = { sent: false, queued: true };

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
        notifications_queued: true,
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
    if (err instanceof ValidationError) return NextResponse.json({error:err.message},{status:err.status});
    console.error('[scheduler/request] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
