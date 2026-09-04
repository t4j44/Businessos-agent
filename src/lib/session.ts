import { createRouteClient } from './supabase-route'
import { getClientId } from './supabase'

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
