import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getSessionClient } from './session'

// One place where every API route decides who is allowed in.
//
// Context: every agent route writes through supabaseAdmin (service role), which
// bypasses RLS. RLS is therefore NOT a backstop for the API surface — these
// checks are the only thing standing between an anonymous request and a
// service-role write.

export class AuthError extends Error {
  status: number
  payload: Record<string, unknown>

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? 'Unauthorized'))
    this.name = 'AuthError'
    this.status = status
    this.payload = payload
  }
}

/**
 * A signed-in user who has a client row.
 *
 * The client id comes from the session and nowhere else — accepting one from a
 * request body would let any signed-in user act on another tenant.
 */
export async function requireSession(): Promise<{ clientId: string; userId: string }> {
  const session = await getSessionClient()

  if (!session) {
    throw new AuthError(401, { error: 'Not signed in' })
  }
  if (!session.clientId) {
    throw new AuthError(404, { error: 'No client for this user', needs_onboarding: true })
  }

  return { clientId: session.clientId, userId: session.userId }
}

/**
 * A signed-in user, with or without a client row.
 * Used by onboarding, which is what creates the client row in the first place.
 */
export async function requireUser(): Promise<{ userId: string; clientId: string | null }> {
  const session = await getSessionClient()

  if (!session) {
    throw new AuthError(401, { error: 'Not signed in' })
  }

  return { userId: session.userId, clientId: session.clientId }
}

// Length-independent constant-time compare. timingSafeEqual throws when the
// buffers differ in length, which would itself leak length, so the lengths are
// checked first and a dummy compare still runs.
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)

  if (a.length !== b.length) {
    // Constant-ish work regardless, then reject.
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}

/**
 * True when the request carries `Authorization: Bearer <CRON_SECRET>`.
 *
 * Fails closed: if CRON_SECRET is unset in the environment this returns false,
 * never true. The previous inline check (`auth !== 'Bearer ' + process.env.X`)
 * failed OPEN when the variable was undefined — the literal string
 * "Bearer undefined" satisfied it.
 */
export function hasCronSecret(req: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return false

  return secretMatches(header.slice('Bearer '.length), expected)
}

/**
 * Either a valid cron bearer token or a signed-in session.
 *
 * Used by the agent routes that /api/cron/* invokes over HTTP. When the caller
 * is the cron, the client id must come from the body — the cron iterates every
 * active client and has no session of its own.
 */
export async function requireCronOrSession(
  req: Request,
  bodyClientId?: string,
): Promise<{ clientId: string; viaCron: boolean }> {
  if (hasCronSecret(req)) {
    const clientId = String(bodyClientId ?? '').trim()
    if (!clientId) {
      throw new AuthError(400, { error: 'client_id is required for scheduled runs' })
    }
    return { clientId, viaCron: true }
  }

  const { clientId } = await requireSession()
  return { clientId, viaCron: false }
}

/** Cron-only routes: a valid CRON_SECRET and nothing else. */
export async function requireCron(req: Request): Promise<void> {
  if (!hasCronSecret(req)) {
    throw new AuthError(401, { error: 'Unauthorized' })
  }
}

export function isProduction(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' ||
    (process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV)
  )
}

/**
 * Test and diagnostic routes call this first. In production they should not
 * exist at all — 404 rather than 403, so their presence is not confirmed.
 */
export function notFoundInProduction(): NextResponse | null {
  if (!isProduction()) return null
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/** Turns a thrown AuthError into its response; rethrows anything else. */
export function authErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AuthError) {
    return NextResponse.json(err.payload, { status: err.status })
  }
  return null
}
