import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runBiReporter } from '../route';

// Batch entry point used by the Vercel cron (/api/cron/bi-reporter).
//
// The base POST /api/agents/bi-reporter generates and stores a brief. This
// wrapper adds delivery: it emails the brief and stamps sent_at, so the cron
// only has to pass { client_id, send_email }.
export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const params = await req.json();
    const { client_id, metrics } = params;

    if (!client_id) {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 });
    }

    const { status, body } = await runBiReporter(client_id, metrics);
    if (status !== 200) {
      return NextResponse.json(body, { status });
    }

    const briefId = body.brief_id;
    const brief_html = body.brief_html;

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('name, contact_email')
      .eq('id', client_id)
      .maybeSingle();

    let emailed = false;

    if (params.send_email && process.env.RESEND_API_KEY && client?.contact_email) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Business OS <briefs@businessos.ai>',
          to: client.contact_email,
          subject: 'Your Monday Brief — ' + (client.name || 'Business OS'),
          html: brief_html
        });
        await supabaseAdmin.from('weekly_briefs')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', briefId)
        console.log('Monday Brief sent to', client.contact_email)
        emailed = true;
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
