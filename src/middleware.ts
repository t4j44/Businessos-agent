import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase-middleware'

// Auth gate.
//
// Only /dashboard/* is gated. API routes are deliberately NOT redirected:
// Vercel cron jobs (/api/cron/*) authenticate with a CRON_SECRET header and
// carry no session cookie, embedded widgets call /api/widget/* cross-origin
// from other people's sites, and Stripe/Bland/Instantly post to
// /api/webhooks/* as unauthenticated machines. Redirecting any of those to an
// HTML login page would break them silently — those routes do their own
// authorisation.

// Always reachable, even under a future stricter policy.
// Pages that must load without a session. The /api entries below are now
// unreachable by this check (see the /api/ short-circuit in middleware) and
// are kept only as a record of what is intentionally public.
const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/pricing',
  '/api/health',
  '/api/health/keys',
  // The recipient of an unsubscribe link is never a signed-in user.
  '/api/unsubscribe',
])

const PUBLIC_PREFIXES = [
  '/api/auth/',
  '/api/webhooks/',
  '/api/widget/',   // widget config + chat, called from customer sites
  '/widget/',       // the served widget.js asset itself
]

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  // API routes carry their own guards (requireSession / requireCron /
  // webhook signatures). Gating them here would redirect webhooks and cron
  // to an HTML login page, so middleware stays out of /api entirely.
  if (pathname.startsWith('/api/')) return response

  // Pages are deny-by-default. The previous rule only tested
  // startsWith('/dashboard'), which is why isPublic() was computed and then
  // ignored — and why removing '/test' from PUBLIC_PREFIXES had no effect.
  // Anything not explicitly public now requires a session, including pages
  // added later that nobody remembers to add to an allowlist.
  if (!isPublic(pathname) && !user) {
    const loginUrl = new URL('/login', request.url)
    // So the user lands back where they were aiming after signing in.
    loginUrl.searchParams.set('redirectedFrom', pathname)

    const redirect = NextResponse.redirect(loginUrl)
    // Carry over any rotated auth cookies; dropping them here would discard
    // the refresh that just happened.
    response.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value, cookie)
    })
    return redirect
  }

  return response
}

export const config = {
  // Everything except static assets and image files — auth cookies must be
  // refreshed on page and API requests, not on chunk downloads.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
