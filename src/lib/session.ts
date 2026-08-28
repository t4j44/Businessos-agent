import { createRouteClient } from './supabase-route'
import { getClientId } from './supabase'
import { TEST_CLIENT_ID } from './client-config'

// Resolving "which client is this request for" from the signed-in user.
//
// The browser must never be trusted to supply its own client_id: accepting one
// from a query string would let any signed-in user read another tenant's data
// by changing a number in the URL. Session first, always.

export type SessionClient = {
  userId: string
  clientId: string | null
}

/** The signed-in user and their client row, or null when nobody is signed in. */
export async function getSessionClient(): Promise<SessionClient | null> {
  try {
    const supabase = await createRouteClient()
    const { data } = await supabase.auth.getUser()
    const user = data?.user
    if (!user) return null

    return { userId: user.id, clientId: await getClientId(user.id) }
  } catch (err) {
    console.warn('[session] could not resolve session client:', err)
    return null
  }
}

/**
 * The client id a dashboard API should read for.
 *
 * Order: the signed-in user's own client, then an explicit ?client_id= (only
 * honoured when there is no session — this is how the cron jobs and /test
 * routes address a client), then the test client.
 *
 * Returns `unauthorized: true` when a session exists but has no client row yet,
 * so the caller can send the user to onboarding rather than showing an empty
 * dashboard belonging to nobody.
 */
export async function resolveClientId(req?: Request): Promise<{
  clientId: string
  authenticated: boolean
  needsOnboarding: boolean
}> {
  const session = await getSessionClient()

  if (session) {
    if (session.clientId) {
      return { clientId: session.clientId, authenticated: true, needsOnboarding: false }
    }
    // Signed in, but no client record has been created yet.
    return { clientId: TEST_CLIENT_ID, authenticated: true, needsOnboarding: true }
  }

  const fromQuery = req ? new URL(req.url).searchParams.get('client_id') : null

  return {
    clientId: fromQuery || TEST_CLIENT_ID,
    authenticated: false,
    needsOnboarding: false,
  }
}
