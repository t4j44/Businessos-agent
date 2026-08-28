import { NextResponse } from 'next/server'
import { notFoundInProduction } from '@/lib/auth-guard'

// GET /api/test/env-check — which integration keys this deployment has.
//
// Presence only: every value is coerced to a boolean, so no secret can leave
// the server through this route.
//
// NOTE ON KEY NAMES: the project calls models through OpenRouter, so the model
// key is OPENROUTER_API_KEY — ANTHROPIC_API_KEY is not used by any agent. The
// telephony key is BLAND_API_KEY (not BLAND_AI_KEY), matching .env.local and
// /api/dashboard/settings.
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  const checks = {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    voyage: Boolean(process.env.VOYAGE_API_KEY),
    brave: Boolean(process.env.BRAVE_API_KEY),
    bland: Boolean(process.env.BLAND_API_KEY),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    resend: Boolean(process.env.RESEND_API_KEY),
  }

  return NextResponse.json(checks, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
