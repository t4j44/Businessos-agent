import { supabaseAdmin } from './supabase'

// Resolving "which client row does this signed-in user own" for the onboarding
// routes.
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// /api/onboarding/analyze used to do a bare
//
//     supabaseAdmin.from('clients').insert({ name, url, status })
//
// with no user_id. getClientId() in src/lib/supabase.ts resolves the dashboard's
// client with .eq('user_id', userId), so that row was invisible to the very
// user who had just created it: onboarding wrote a full brand profile into an
// orphan client while the dashboard kept reading the user's own, empty one.
// The symptom was "No website on file / No brand profile yet / Brand Memory:
// 0 pieces" immediately after a Brand Scout run that had visibly succeeded.
//
// Every client row this project creates now goes through here, and every one
// carries a user_id.

export type EnsuredClient = {
  clientId: string
  /** True when a row was inserted rather than reused. */
  created: boolean
}

export class ClientWriteError extends Error {
  /** Postgres error code, e.g. '42703' for undefined_column. */
  code: string | null

  constructor(message: string, code: string | null) {
    super(message)
    this.name = 'ClientWriteError'
    this.code = code
  }
}

/**
 * The caller's own client row, creating it if this is their first run.
 *
 * `seed` is applied on insert and, for the fields it names, on update too —
 * onboarding is the step that establishes the website URL, so a second run
 * against a different address should move the existing row rather than fork a
 * new one.
 */
export async function ensureClientForUser(
  userId: string,
  seed: { name?: string | null; url?: string | null; industry?: string | null;
          contact_email?: string | null; contact_phone?: string | null } = {},
): Promise<EnsuredClient> {
  // Fail loudly rather than write a null. requireUser() already rejects an
  // unauthenticated caller, so reaching here without an id means a caller
  // passed one through that it never actually resolved — the exact mistake
  // that produced nine orphan client rows.
  if (!userId) {
    throw new Error('[onboarding] auth.getUser() returned null — user not logged in')
  }

  // Truncated on purpose: enough to correlate a Vercel log line with a row in
  // the clients table, not enough to be a user identifier in a log sink.
  console.log('[onboarding] writing client for user_id:', userId.substring(0, 8))

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (lookupError) {
    console.error(
      `[onboarding-client] client lookup failed (${lookupError.code}):`,
      lookupError.message,
    )
    throw new ClientWriteError(lookupError.message, lookupError.code ?? null)
  }

  if (existing?.id) {
    // Only overwrite what onboarding was actually given. A null in `seed` means
    // "not collected this time", not "clear it".
    const patch: Record<string, unknown> = {}
    if (seed.name) patch.name = seed.name
    if (seed.url) patch.url = seed.url
    if (seed.industry) patch.industry = seed.industry
    if (seed.contact_email) patch.contact_email = seed.contact_email
    if (seed.contact_phone) patch.contact_phone = seed.contact_phone

    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('clients')
        .update(patch)
        .eq('id', existing.id)

      if (updateError) {
        console.error(
          `[onboarding-client] client update failed (${updateError.code}):`,
          updateError.message,
        )
        throw new ClientWriteError(updateError.message, updateError.code ?? null)
      }
    }

    return { clientId: existing.id, created: false }
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .insert({
      // The whole point of this module. Without it the row is unreachable.
      user_id: userId,
      name: seed.name || 'New Business',
      url: seed.url || null,
      industry: seed.industry || null,
      contact_email: seed.contact_email || null,
      contact_phone: seed.contact_phone || null,
      status: 'onboarding',
    })
    .select('id, user_id')
    .single()

  if (error) {
    console.error(
      `[onboarding-client] client insert failed (${error.code}):`,
      error.message,
    )
    throw new ClientWriteError(error.message, error.code ?? null)
  }

  // Read back what was actually stored. A client row without user_id is
  // invisible to getClientId() forever, and the caller would otherwise carry
  // on and report success over a row nobody can ever load.
  if (!data.user_id) {
    throw new ClientWriteError(
      'Client row was created without a user_id — it would be unreachable from the dashboard.',
      null,
    )
  }

  return { clientId: data.id, created: true }
}
