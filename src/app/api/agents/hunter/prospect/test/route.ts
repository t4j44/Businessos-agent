import { NextResponse } from 'next/server'
import { runHunterProspect } from '../route'
import { TEST_CLIENT_ID } from '@/lib/client-config'
import { notFoundInProduction } from '@/lib/auth-guard'

// GET /api/agents/hunter/prospect/test
//
// Smoke test against the fixed test client. Reads the locally-held Overture
// dataset — no external API call and no per-request cost, unlike the Google
// Places version this replaced.
//
// It still upserts real rows into `leads`. If nothing is loaded for this
// state/category, the route returns 200 with an empty list and a `message`
// naming the ETL script.
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  try {
    const result = await runHunterProspect({
      clientId: TEST_CLIENT_ID,
      query: 'dentists in Austin TX',
      maxResults: 5,
    })

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[hunter/prospect/test] failed:', err)
    return NextResponse.json(
      {
        error: 'Prospect failed',
        details: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
