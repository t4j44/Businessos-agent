import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { isTwilioConfigured, sendSMS } from '@/lib/sms';
import {
  getSchedulerContext,
  sendReminderEmail,
  buildReminderText,
  formatWhen,
  type SchedulerContext,
} from '@/lib/appointments';

// GET /api/cron/appointment-reminders
//
// Day-before reminders for confirmed appointments. SMS when Twilio is fully
// configured and the customer left a number, email otherwise.
//
// TIMEZONE: "tomorrow" is computed in UTC. Clients carry a `timezone` column
// (migration 003) that this does not yet consult, so a client far from UTC can
// see reminders land a day early or late relative to their local calendar.
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // confirmed_date is what the confirm step pins down; fall back to
    // requested_date for rows confirmed before that column existed.
    const { data: rows, error } = await supabaseAdmin
      .from('appointments')
      .select(
        'id, client_id, customer_name, customer_email, customer_phone, requested_date, requested_time, confirmed_date, confirmed_time, service_type',
      )
      .eq('status', 'confirmed')
      .eq('reminder_sent', false)
      .or(`confirmed_date.eq.${tomorrow},and(confirmed_date.is.null,requested_date.eq.${tomorrow})`);

    if (error) {
      console.error('[cron/appointment-reminders] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const due = rows || [];
    const twilioReady = isTwilioConfigured();

    // One context lookup per client rather than per appointment.
    const contexts = new Map<string, SchedulerContext>();
    const results: any[] = [];

    // A silent skip is what let the missing clientId go unnoticed for a whole
    // release. These are returned in the response body so a run that sends
    // nothing is visibly different from one with nothing to send.
    let smsSent = 0;
    let smsSkippedNoConsent = 0;
    let smsSkippedSuppressed = 0;
    let emailsSent = 0;

    for (const appt of due) {
      try {
        if (!contexts.has(appt.client_id)) {
          contexts.set(appt.client_id, await getSchedulerContext(appt.client_id));
        }
        const ctx = contexts.get(appt.client_id)!;

        const when = formatWhen(
          appt.confirmed_date || appt.requested_date,
          appt.confirmed_time || appt.requested_time,
        );

        let channel: 'sms' | 'email' | 'none' = 'none';
        let outcome: any = { sent: false, skipped: 'No phone number or email on the appointment.' };

        if (twilioReady && appt.customer_phone) {
          channel = 'sms';
          outcome = await sendSMS(
            appt.customer_phone,
            buildReminderText({
              ctx,
              customerName: appt.customer_name,
              when,
              serviceType: appt.service_type,
            }),
            // Without this, sendSMS cannot verify consent and refuses every
            // send — which is why reminders were silently email-only.
            appt.client_id,
          );

          if (outcome.sent) {
            smsSent++;
          } else {
            const why = String(outcome.skipped || outcome.error || 'unknown');
            if (why.includes('consent')) {
              smsSkippedNoConsent++;
              console.warn(
                '[cron/appointment-reminders] SMS skipped, no phone_consent on record —',
                'appointment', appt.id, '-', why,
              );
            } else if (why.includes('suppressed')) {
              smsSkippedSuppressed++;
              console.warn(
                '[cron/appointment-reminders] SMS skipped, number suppressed —',
                'appointment', appt.id,
              );
            } else {
              console.warn(
                '[cron/appointment-reminders] SMS not sent for appointment',
                appt.id, '-', why,
              );
            }
          }

          // A failed or refused SMS should not cost the customer their
          // reminder when an address is on file.
          if (!outcome.sent && appt.customer_email) {
            channel = 'email';
            outcome = await sendReminderEmail({
              ctx,
              customerName: appt.customer_name,
              customerEmail: appt.customer_email,
              when,
              serviceType: appt.service_type,
            });
            if (outcome.sent) emailsSent++;
          }
        } else if (appt.customer_email) {
          channel = 'email';
          outcome = await sendReminderEmail({
            ctx,
            customerName: appt.customer_name,
            customerEmail: appt.customer_email,
            when,
            serviceType: appt.service_type,
          });
          if (outcome.sent) emailsSent++;
        }

        // Flagged only on a real send, so a transient outage leaves the
        // appointment eligible for tomorrow's run instead of silently skipped.
        if (outcome.sent) {
          await supabaseAdmin
            .from('appointments')
            .update({ reminder_sent: true, updated_at: new Date().toISOString() })
            .eq('id', appt.id);
        }

        results.push({
          appointment_id: appt.id,
          client_id: appt.client_id,
          channel,
          sent: Boolean(outcome.sent),
          detail: outcome.error || outcome.skipped || undefined,
        });
      } catch (e: any) {
        console.error(`[cron/appointment-reminders] ${appt.id} failed:`, e?.message || e);
        results.push({
          appointment_id: appt.id,
          client_id: appt.client_id,
          channel: 'none',
          sent: false,
          detail: e?.message || String(e),
        });
      }
    }

    // One log line per client that had reminders due.
    const byClient = new Map<string, any[]>();
    for (const r of results) {
      if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
      byClient.get(r.client_id)!.push(r);
    }

    await Promise.allSettled(
      [...byClient.entries()].map(([client_id, list]) =>
        logAgentRun({
          client_id,
          agent_type: 'scheduler',
          status: 'completed',
          output_summary: `Sent ${list.filter((r) => r.sent).length}/${list.length} appointment reminders for ${tomorrow}`,
          metadata: {
            step: 'reminder',
            date: tomorrow,
            channel_used: twilioReady ? 'sms_with_email_fallback' : 'email',
            results: list,
          },
        }),
      ),
    );

    return NextResponse.json({
      date: tomorrow,
      due: due.length,
      sent: results.filter((r) => r.sent).length,
      // Per-channel outcome, so a run that sends nothing is distinguishable
      // from a run with nothing to send.
      sms_sent: smsSent,
      sms_skipped_no_consent: smsSkippedNoConsent,
      sms_skipped_suppressed: smsSkippedSuppressed,
      emails_sent: emailsSent,
      twilio_configured: twilioReady,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[cron/appointment-reminders] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
