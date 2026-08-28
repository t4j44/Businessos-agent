import { NextResponse } from 'next/server'
import { notFoundInProduction } from '@/lib/auth-guard'

// GET /api/health/keys — which integrations are configured on this deployment.
//
// Presence only: every value is coerced to a boolean, so no secret can ever
// leave the server through this route. 206 signals "up, but partially
// configured" so an uptime monitor can distinguish it from a hard failure.
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  const checks = {
    openrouter:  Boolean(process.env.OPENROUTER_API_KEY),
    supabase:    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    resend:      Boolean(process.env.RESEND_API_KEY),
    voyage:      Boolean(process.env.VOYAGE_API_KEY),
    bland:       Boolean(process.env.BLAND_API_KEY),
    jina:        true, // no key required
  }
  const allGood = Object.values(checks).every(Boolean)
  return NextResponse.json(
    { allGood, checks },
    { status: allGood ? 200 : 206, headers: { 'Cache-Control': 'no-store' } },
  )
}
