import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runBiReporter } from '../route';
import { requireCronOrSession, authErrorResponse } from '@/lib/auth-guard';
import { sendBrandedEmail } from '@/lib/resend';

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

    const { status, body } = await runBiReporter(client_id);
    if (status !== 200) {
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

    if (!hasBriefContent && params.send_email) {
      console.warn('[bi-reporter/generate] brief_html was empty — skipping email for', client_id);
    }

    if (params.send_email && hasBriefContent && client?.contact_email) {
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
        });

        if (result.sent) {
          await supabaseAdmin.from('weekly_briefs')
            .update({ sent_at: new Date().toISOString() })
            .eq('id', briefId)
          console.log('[bi-reporter] Monday Brief emailed for client', client_id)
          emailed = true;
        } else {
          // Suppressed, or refused for a missing postal address. sent_at stays
          // null so this is not recorded as delivered.
          console.warn(
            '[bi-reporter] brief not sent for client', client_id,
            '-', result.skipped || result.error,
          )
        }
      } catch (e) {
        console.error('Brief email failed (not critical):', e)
      }
    }

    return NextResponse.json({ ...body, emailed }, { status: 200 });
  } catch (err: any) {
    console.error('[bi-reporter/generate] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
