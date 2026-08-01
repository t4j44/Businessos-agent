import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the Supabase auth cookies on every request so server components and
// route handlers always read a valid token. It does not gate access — routing
// decisions stay in the pages themselves.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // With no credentials there is no session to refresh. Returning early beats
  // throwing "supabaseKey is required." on every single request.
  if (!url || !anonKey) return supabaseResponse

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // getUser() revalidates the token against the auth server, which is what
  // triggers the refresh and writes the rotated cookies. getSession() only
  // reads what is already in the cookie and is never verified — do not use it.
  await supabase.auth.getUser()

  return supabaseResponse
}
