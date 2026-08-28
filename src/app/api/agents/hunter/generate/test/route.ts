import { NextResponse } from 'next/server'
import { runHunterGenerate } from '../route'
import { TEST_CLIENT_ID } from '@/lib/client-config'
import { notFoundInProduction } from '@/lib/auth-guard'

// GET /api/agents/hunter/generate/test
//
// Smoke test only. website is deliberately '' so runHunterGenerate skips the
// readWebsite() step entirely — this route never fetches an external site.
//
// It still calls the model and writes an agent_runs row, so it costs real
// money on every visit. Use it deliberately, not on refresh.
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  const { status, body } = await runHunterGenerate({
    client_id: TEST_CLIENT_ID,
    lead: {
      name: 'Sarah Chen',
      company: 'Bright Smile Dental',
      role: 'Practice Owner',
      pain_point: 'Missed appointments and slow invoice collection',
      website: '', // empty on purpose — no website read in the smoke test
    },
    sequence: 'initial',
  })

  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
