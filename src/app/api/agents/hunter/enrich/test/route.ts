import { NextResponse } from 'next/server'
import { runHunterEnrich } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { TEST_CLIENT_ID } from '@/lib/client-config'
import { notFoundInProduction } from '@/lib/auth-guard'

// GET /api/agents/hunter/enrich/test
//
// Smoke test. No auth — runs against the fixed test client. Picks the oldest
// un-enriched lead that has a website and enriches it for real: a live page
// read, a DNS lookup, a model call, and a write back to the leads row.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  try {
    const { data: lead, error } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('client_id', TEST_CLIENT_ID)
      .eq('outreach_status', 'new')
      .not('website', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!lead) {
      return NextResponse.json(
        { error: 'No leads to enrich. Run /api/agents/hunter/prospect/test first.' },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const result = await runHunterEnrich({
      clientId: TEST_CLIENT_ID,
      leadId: lead.id,
    })

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[hunter/enrich/test] failed:', err)
    return NextResponse.json(
      {
        error: 'Enrich failed',
        details: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
