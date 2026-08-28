import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveClientId } from '@/lib/session'

// GET /api/dashboard/hunter — the lead pipeline for the Hunter screen.
//
// Stats are computed from the rows already returned rather than issuing count
// queries, so the whole page costs one round trip.
const LIMIT = 50

export async function GET(req: NextRequest) {
  try {
    const { clientId } = await resolveClientId(req)

    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('client_id', clientId)
      // `leads` carries two independent pipelines with two status columns:
      // Apollo/CSV rows use `status`, prospected rows use `outreach_status`.
      // Filtering on place_id rather than source, because source is only set by
      // the prospect route while place_id is present on every prospected row.
      .not('place_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(LIMIT)

    if (error) {
      console.error('[dashboard/hunter] query failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const leads = data ?? []
    const countOf = (status: string) =>
      leads.filter((l: any) => l.outreach_status === status).length

    // Only leads that have actually been scored count toward the average — a
    // pile of un-enriched rows would otherwise drag it toward zero and read as
    // a quality problem rather than a queue.
    const scored = leads.filter((l: any) => typeof l.icp_match_score === 'number')
    const avgIcp = scored.length
      ? Math.round(scored.reduce((sum: number, l: any) => sum + l.icp_match_score, 0) / scored.length)
      : 0

    return NextResponse.json(
      {
        leads,
        stats: {
          total: leads.length,
          new: countOf('new'),
          enriched: countOf('enriched'),
          emailed: countOf('emailed'),
          avg_icp_score: avgIcp,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err: any) {
    console.error('[dashboard/hunter] GET failed:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
