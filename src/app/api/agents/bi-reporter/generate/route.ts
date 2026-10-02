import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runBiReporter } from '../route';
import { requireCronOrSession, authErrorResponse } from '@/lib/auth-guard';
import { sendBrandedEmail } from '@/lib/resend';
import { serverError } from '@/lib/server-error'
import { getMondayDateString } from '@/lib/week';

// sendBrandedEmail needs a plain-text alternative; the brief is generated as
// HTML only. Good enough for a text/plain part: strip tags, collapse space.
function htmlToText(value: string): string {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Batch entry point used by the Vercel cron (/api/cron/bi-reporter).
//
// The base POST /api/agents/bi-reporter generates and stores a brief. This
// wrapper adds delivery: it emails the brief and stamps sent_at, so the cron
// only has to pass { client_id, send_email }.
//
// ONE EMAIL PER CLIENT PER WEEK. This route used to email and then stamp
// sent_at with nothing checked first, so a retry or a second cron invocation
// delivered the brief twice. Delivery is now gated by a claim in
// weekly_brief_sends, which carries UNIQUE (client_id, week_start): two
// simultaneous runs both call claim_weekly_brief_send and exactly one wins the
// insert. See supabase/migrations/037_weekly_brief_sends.sql for why the
// constraint is not on weekly_briefs itself.
//
// The claim is taken BEFORE the brief is generated, so a week that has already
// been delivered does not pay for another AI call. The manual "Generate Brief"
// button is unaffected: it posts to /api/agents/bi-reporter, which never emails.
export async function POST(req: Request) {
  let clientId: string;
  let reqBody: any = {};
  try {
    reqBody = await req.json().catch(() => ({}));
    ({ clientId } = await requireCronOrSession(req, reqBody?.client_id));
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const params = reqBody;
    const client_id = clientId;

    if (!client_id) {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 });
    }

    // runBiReporter derives the same week key from the same helper when no
    // override is passed, so these two always agree.
    const weekStart = params.week_start_date
      ? String(params.week_start_date).slice(0, 10)
      : getMondayDateString();
    const wantsEmail = Boolean(params.send_email);

    // ── Claim the week's delivery before spending anything ────────────────
    let claim: any = null;
    if (wantsEmail) {
      const claimed = await supabaseAdmin.rpc('claim_weekly_brief_send', {
        p_client_id: client_id,
        p_week_start: weekStart,
      });

      if (claimed.error) {
        // Cannot prove this week is unsent, so refuse rather than risk a second
        // copy. 503 because the cron should try again, not record a failure.
        console.error('[bi-reporter/generate] claim failed:', claimed.error.code);
        return NextResponse.json(
          { success: false, error: 'Brief delivery could not be claimed.' },
          { status: 503 },
        );
      }

      claim = claimed.data;
      if (!claim?.claimed) {
        // already_sent | in_progress | needs_review. No generation, no email.
        console.log(
          '[bi-reporter] delivery skipped for', client_id, weekStart, '-', claim?.reason,
        );
        return NextResponse.json(
          {
            success: true,
            emailed: false,
            week_start: weekStart,
            skipped: claim?.reason || 'claim_unavailable',
          },
          { status: 200 },
        );
      }
    }

    const { status, body } = await runBiReporter(client_id);
    if (status !== 200) {
      // Nothing was sent, so hand the week back for the next run.
      if (claim) {
        await supabaseAdmin.rpc('release_weekly_brief_send', {
          p_client_id: client_id, p_week_start: weekStart, p_error: 'brief_generation_failed',
        });
      }
      return NextResponse.json(body, { status });
    }

    const briefId = body.brief_id;

    // runBiReporter falls back to '' when the model returns no brief_html, and
    // Resend's CreateEmailOptions will not accept undefined. Normalise to a
    // string here so the send site always has valid content.
    const rawHtml = body.brief_html;
    const html =
      typeof rawHtml === 'string' && rawHtml.trim().length > 0
        ? rawHtml
        : '<p>' + String(rawHtml ?? '') + '</p>';

    // Whether there is anything worth mailing. An empty brief is worse than no
    // brief, so a blank body is logged and skipped rather than delivered.
    const hasBriefContent = typeof rawHtml === 'string' && rawHtml.trim().length > 0;

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('name, contact_email')
      .eq('id', client_id)
      .maybeSingle();

    let emailed = false;
    let skipped: string | null = null;

    // Hand the claim back whenever we hold one and nothing was delivered, so a
    // later run can try again.
    const release = async (reason: string) => {
      skipped = reason;
      if (!claim) return;
      await supabaseAdmin.rpc('release_weekly_brief_send', {
        p_client_id: client_id, p_week_start: weekStart, p_error: reason,
      });
    };

    if (wantsEmail && !hasBriefContent) {
      console.warn('[bi-reporter/generate] brief_html was empty — skipping email for', client_id);
      await release('empty_brief');
    } else if (wantsEmail && !client?.contact_email) {
      await release('owner_email_missing');
    } else if (wantsEmail && hasBriefContent && client?.contact_email) {
      try {
        // Through sendBrandedEmail, not a bare Resend client: the Monday Brief
        // is a recurring commercial email, so CAN-SPAM requires the postal
        // address, the suppression check and List-Unsubscribe. No transactional
        // flag — this one gets the full footer.
        const result = await sendBrandedEmail({
          clientId: client_id,
          from_name: client.name || 'Business OS',
          to: client.contact_email,
          subject: 'Your Monday Brief — ' + (client.name || 'Business OS'),
          html,
          text: htmlToText(html),
          // Deterministic for this client and week. If a previous attempt died
          // after reaching Resend, this attempt gets the original receipt back
          // rather than delivering a second copy.
          idempotencyKey: claim?.idempotency_key,
        });

        if (result.sent && result.email_id) {
          // Only a provider receipt closes the claim, and the same call stamps
          // weekly_briefs.sent_at so the two can never disagree.
          const finished = await supabaseAdmin.rpc('finish_weekly_brief_send', {
            p_client_id: client_id,
            p_week_start: weekStart,
            p_brief_id: briefId,
            p_provider_id: result.email_id,
          });

          emailed = true;
          if (finished.error || finished.data !== true) {
            // Delivered, but not recorded. Say so instead of claiming a clean
            // run: the claim stays 'sending' and its lease governs any retry,
            // where the idempotency key prevents a second copy.
            skipped = 'delivered_but_not_recorded';
            console.error(
              '[bi-reporter] brief delivered but the send record did not close for',
              client_id, weekStart, '-', finished.error?.code ?? 'precondition_failed',
            );
          } else {
            console.log('[bi-reporter] Monday Brief emailed for client', client_id);
          }
        } else {
          // Suppressed, refused for a missing postal address, or rejected by the
          // provider. Nothing reached the inbox, so this week is retryable.
          console.warn(
            '[bi-reporter] brief not sent for client', client_id,
            '-', result.skipped || result.error,
          );
          await release(result.skipped || 'provider_rejected');
        }
      } catch (e) {
        // Ambiguous: the provider may already have accepted it. Deliberately NOT
        // released — the lease expiry decides, and the idempotency key makes the
        // retry safe inside Resend's 24-hour window.
        skipped = 'delivery_attempt_failed';
        console.error('[bi-reporter] brief email attempt failed for', client_id, e);
      }
    }

    return NextResponse.json(
      { ...body, emailed, week_start: weekStart, ...(skipped ? { skipped } : {}) },
      { status: 200 },
    );
  } catch (err: any) {
    console.error('[bi-reporter/generate] POST failed:', err);
    return serverError(err, 'agents/bi-reporter/generate');
  }
}
