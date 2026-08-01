import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

// ── Admin client (service role, bypasses RLS) ────────────────────────────────
//
// Built lazily. SUPABASE_SERVICE_ROLE_KEY is not a NEXT_PUBLIC_ variable, so it
// is `undefined` in the browser bundle. Creating this client at module scope
// therefore threw "supabaseKey is required." as soon as any client component
// imported anything from this file — which is what crashed the login page.
// The Proxy defers construction to first property access, so browser code that
// merely imports this module never builds it.
let _admin: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
  }
  return _admin
}

// Proxy forwards the whole client surface (.from, .storage, .rpc, …) so every
// existing call site keeps working unchanged.
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin()
    const value = Reflect.get(client as any, prop, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

// NEW — helper for agents to fetch a client's brand context
export async function getClientContext(clientId: string) {
  const { data: client } = await supabaseAdmin
    .from('clients').select('*').eq('id', clientId).single()
  const { data: brand } = await supabaseAdmin
    .from('brand_profiles').select('*').eq('client_id', clientId).single()
  return { client, brand }
}

// ── Browser client ───────────────────────────────────────────────────────────
// Also lazy, so it is only constructed when first used rather than at import.
let _browser: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowser() {
  if (!_browser) {
    _browser = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return _browser
}

// Keep the export name for backward compatibility
export const supabaseBrowser = {
  get auth() { return getSupabaseBrowser().auth },
  from: (table: string) => getSupabaseBrowser().from(table),
}

// ── Server client used by onboarding and widget routes ───────────────────────
// Same service-role credentials as supabaseAdmin, so it shares the same lazy
// Proxy. Building it at module scope threw "supabaseKey is required." during
// `next build`, when the key is not present in the prerender environment.
export const supabaseServer: SupabaseClient = supabaseAdmin

export async function getClientId(userId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from('clients').select('id').eq('user_id', userId).maybeSingle()
  return data?.id ?? null
}
