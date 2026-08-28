import { NextResponse } from 'next/server'
import { runForClient } from '../route'
import { TEST_CLIENT_ID } from '@/lib/client-config'
import { notFoundInProduction } from '@/lib/auth-guard'

// GET /api/agents/nightwatch/test
//
// Browser-visitable smoke test for the test client only — never the whole book
// of clients.
//
// This runs the real orchestrator: up to three intelligence agents plus the
// synthesis, writing to weekly_briefs, rag_chunks and approvals_queue. It is
// the most expensive endpoint in the app. Visit it deliberately, not on
// refresh.
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY missing' }, { status: 503 })
  }

  const { status, body } = await runForClient(TEST_CLIENT_ID)

  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
