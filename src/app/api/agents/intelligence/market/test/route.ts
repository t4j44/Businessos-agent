import { NextResponse } from 'next/server'
import { runMarketIntelligence } from '../route'
import { TEST_CLIENT_ID } from '@/lib/client-config'
import { notFoundInProduction } from '@/lib/auth-guard'

// GET /api/agents/intelligence/market/test
//
// Browser-visitable smoke test for the market intelligence agent. Runs the
// real logic against a fixed competitor set, so it makes real model and search
// calls and costs real money — it is a manual check, not something to put on
// a schedule.
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  const { status, body } = await runMarketIntelligence({
    client_id: TEST_CLIENT_ID,
    competitors: ['hubspot.com', 'salesforce.com'],
    industry: 'SaaS CRM',
    run_type: 'quick',
  })

  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
