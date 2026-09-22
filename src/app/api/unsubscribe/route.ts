import { supabaseAdmin } from '@/lib/supabase'
import { suppress, companyName } from '@/lib/compliance'

// GET /api/unsubscribe?token=…
//
// Public by design: the recipient is not a user of the app and will never have
// a session. The token is the only credential.
//
// An unknown, missing or already-used token renders exactly the same
// confirmation page as a valid one. Anything else would turn this endpoint into
// an oracle for whether a given address is on a client's list.
export const dynamic = 'force-dynamic'

function page(message: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Unsubscribed</title>
<style>
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; background: #08070C; color: #F2F0F7;
    font-family: Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 24px;
  }
  .card {
    max-width: 440px; width: 100%; background: #100E16;
    border: 1px solid #262233; border-radius: 10px; padding: 32px; text-align: center;
  }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em; }
  p { font-size: 14px; line-height: 1.6; color: #8B87A0; margin: 0; }
  .mark {
    width: 40px; height: 40px; border-radius: 10px; margin: 0 auto 16px;
    background: rgba(79,191,139,0.1); color: #4FBF8B; font-size: 20px;
    display: flex; align-items: center; justify-content: center;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="mark">&#10003;</div>
    <h1>You're unsubscribed</h1>
    <p>${message}</p>
  </div>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function GET(req: Request) {
  const CONFIRM =
    `You will not receive further marketing email from ${companyName()}. ` +
    'Service messages about an active booking or invoice may still be sent.'

  try {
    const token = new URL(req.url).searchParams.get('token')
    if (!token) return page(CONFIRM)

    const { data: row } = await supabaseAdmin
      .from('unsubscribe_tokens')
      .select('client_id, channel, address')
      .eq('token', token)
      .maybeSingle()

    // Unknown token: same page, no signal either way.
    if (!row) return page(CONFIRM)

    await suppress(
      row.client_id,
      (row.channel as 'email' | 'sms') ?? 'email',
      row.address,
      'unsubscribe',
    )

    await supabaseAdmin
      .from('unsubscribe_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)

    // Mirror the opt-out onto the lead record so outbound agents see it too.
    if (row.channel === 'sms') {
      await supabaseAdmin
        .from('leads')
        .update({ phone_consent: false })
        .eq('client_id', row.client_id)
        .eq('phone', row.address)
    } else {
      await supabaseAdmin
        .from('leads')
        .update({ email_consent: false })
        .eq('client_id', row.client_id)
        .eq('email', row.address)
    }

    return page(CONFIRM)
  } catch (err) {
    // Even a failure renders the confirmation — the suppression write is
    // logged, and revealing an error here would leak token validity.
    console.error('[unsubscribe] failed:', err)
    return page(CONFIRM)
  }
}
