export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { data: clients } = await supabaseAdmin
    .from('clients').select('id, name').eq('status', 'active')
  const results = []
  for (const client of (clients || [])) {
    try {
      const res = await fetch(
        process.env.NEXT_PUBLIC_APP_URL + '/api/agents/reputation/analyze',
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id }) }
      )
      results.push({ client: client.name, status: res.ok ? 'ok' : 'failed' })
    } catch (e) { results.push({ client: client.name, status: 'error' }) }
  }
  return Response.json({ processed: results.length, results, timestamp: new Date().toISOString() })
}
