import { NextResponse } from 'next/server'
import { runTrendRadar } from '../route'
import { TEST_CLIENT_ID } from '@/lib/client-config'
import { notFoundInProduction } from '@/lib/auth-guard'

// GET /api/agents/intelligence/trends/test
//
// Browser-visitable smoke test. This runs the real agent: it reads Reddit and
// Brave, calls the model, and — for any trend it rates 'post today' — inserts
// a draft into approvals_queue for the test client. Every visit costs money
// and can add pending approvals, so treat it as a manual check rather than
// something to refresh repeatedly.
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  const { status, body } = await runTrendRadar({
    client_id: TEST_CLIENT_ID,
    industry: 'dental',
    keywords: ['patient experience', 'dental technology', 'insurance'],
  })

  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
