import { supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { isTwilioConfigured, sendSMS } from '@/lib/sms';
import { cronHandler, SkipCounter } from '@/lib/cron';
import {
  getSchedulerContext,
  sendReminderEmail,
  buildReminderText,
  formatWhen,
  type SchedulerContext,
} from '@/lib/appointments';

// GET /api/cron/appointment-reminders — daily, early US morning.
//
// Day-before reminders for confirmed appointments. SMS when Twilio is fully
// configured and the customer left a number, email otherwise.
//
// THE BUG THIS ROUTE IS NAMED AFTER: for weeks every SMS here was refused for
// missing phone_consent, the email fallback quietly took over, and the cron
// reported success each night. Nothing in the response said "0 of 40 sent by
// SMS, 40 skipped: no_consent". Now it does — `skipped` is keyed by reason,
// and a run that sends nothing is a different body from a run with nothing
// to send.
//
// TIMEZONE: "tomorrow" is computed in UTC. Clients carry a `timezone` column
// (migration 003) that this does not yet consult, so a client far from UTC can
// see reminders land a day early or late relative to their local calendar.

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = cronHandler({
  name: 'appointment-reminders',
  agentType: 'scheduler',
  async run() {
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

    if (error) throw new Error(`appointments query failed: ${error.message}`);

    const due = rows ?? [];
    const twilioReady = isTwilioConfigured();

    // One context lookup per client rather than per appointment.
    const contexts = new Map<string, SchedulerContext>();
    const results: any[] = [];
    const skipped = new SkipCounter();

    let smsSent = 0;
    let emailsSent = 0;
    let errors = 0;

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
        // Why the SMS did not go, when it did not. Recorded even if email
        // then succeeds — the point is to see the SMS path failing.
        let smsReason: string | null = null;

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
            const why = String(outcome.skipped || outcome.error || 'unknown').toLowerCase();
            smsReason = why.includes('consent') ? 'sms_no_consent'
              : why.includes('suppress') ? 'sms_suppressed'
              : 'sms_failed';
            skipped.add(smsReason);
            console.warn(`[cron/appointment-reminders] ${smsReason} for appointment ${appt.id} — ${why}`);
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
            else skipped.add('email_failed');
          }
        } else if (appt.customer_email) {
          channel = 'email';
          if (appt.customer_phone && !twilioReady) skipped.add('sms_twilio_not_configured');
          outcome = await sendReminderEmail({
            ctx,
            customerName: appt.customer_name,
            customerEmail: appt.customer_email,
            when,
            serviceType: appt.service_type,
          });
          if (outcome.sent) emailsSent++;
          else skipped.add('email_failed');
        } else {
          skipped.add('no_contact_method');
        }

        // Flagged only on a real send, so a transient outage leaves the
        // appointment eligible for tomorrow's run instead of silently skipped.
        if (outcome.sent) {
          const { error: flagError } = await supabaseAdmin
            .from('appointments')
            .update({ reminder_sent: true, updated_at: new Date().toISOString() })
            .eq('id', appt.id);
          if (flagError) {
            // The reminder went out; the flag did not. Tomorrow's run will
            // send it again unless this is seen.
            console.error(`[cron/appointment-reminders] reminder_sent flag failed for ${appt.id}:`, flagError.message);
          }
        }

        results.push({
          appointment_id: appt.id,
          client_id: appt.client_id,
          channel,
          sent: Boolean(outcome.sent),
          sms_reason: smsReason,
          detail: outcome.error || outcome.skipped || undefined,
        });
      } catch (e: any) {
        errors++;
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

    // One per-client log row, so the reminders show in that client's activity
    // feed. The cron-level row (client_id null) is written by cronHandler.
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

    return {
      scanned: due.length,
      acted: smsSent + emailsSent,
      skipped: skipped.toJSON(),
      errors,
      detail: {
        date: tomorrow,
        sms_sent: smsSent,
        emails_sent: emailsSent,
        twilio_configured: twilioReady,
        results,
      },
    };
  },
});
