import { NextResponse } from 'next/server'
import { runAudienceIntelligence } from '../route'
import { TEST_CLIENT_ID } from '@/lib/client-config'
import { notFoundInProduction } from '@/lib/auth-guard'

// GET /api/agents/intelligence/audience/test
//
// Browser-visitable smoke test. This runs the real agent: it hits Reddit and
// Brave, calls Sonnet, and writes RAG chunks for the test client. Every visit
// costs money and mutates rag_chunks, so treat it as a manual check rather
// than something to refresh repeatedly or put on a schedule.
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  const { status, body } = await runAudienceIntelligence({
    client_id: TEST_CLIENT_ID,
    icp_description: 'dental clinic owners in the US',
    industry: 'dental',
    keywords: ['missed appointments', 'invoice chasing', 'online reviews'],
  })

  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
