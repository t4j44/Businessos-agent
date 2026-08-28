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

  if (isPublic(pathname)) return response

  if (pathname.startsWith('/dashboard') && !user) {
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
