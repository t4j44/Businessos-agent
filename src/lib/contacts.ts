// Contact Intelligence. Server-side only — supabaseAdmin uses the service-role
// key, which is not a NEXT_PUBLIC_ variable, so this module carries no client
// directive.
//
// supabaseAdmin is the exact export name from src/lib/supabase.ts (a lazy Proxy
// over the service-role client; getSupabaseAdmin() is the underlying builder).

import { supabaseAdmin } from './supabase'
import { storeChunk } from './embeddings'

const SCORE_MIN = 0
const SCORE_MAX = 100

// Contact history is filed under its own chunk_type rather than 'brand'.
// brand-scout deletes chunk_type IN ('brand','icp','voice') on every re-scan,
// so filing interactions as 'brand' would wipe a client's contact history the
// next time their website was scraped.
const CONTACT_CHUNK_TYPE = 'contact'

export type ContactRef = { id: string; score: number; status: string }

// ── 1. Find or create ────────────────────────────────────────────────────────
export async function findOrCreateContact(params: {
  client_id: string
  email?: string
  phone?: string
  name?: string
  source?: string
}): Promise<ContactRef | null> {
  const email = params.email?.trim().toLowerCase() || null
  const phone = params.phone?.replace(/[\s().-]/g, '') || null
  if (!email && !phone) return null
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) return null
  const { data, error } = await supabaseAdmin.rpc('resolve_contact', {
    p_client_id: params.client_id, p_email: email, p_phone: phone,
    p_name: params.name?.slice(0, 200) || null, p_source: params.source || null,
  })
  if (error) { console.error('[contacts] identity resolution failed:', error.code); return null }
  return data as ContactRef | null
}

// ── 2. Log an interaction ────────────────────────────────────────────────────
export async function logInteraction(params: {
  contact_id: string
  client_id: string
  agent_name: string
  interaction_type: string
  summary: string
  sentiment_score?: number
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('contact_interactions').insert({
      contact_id: params.contact_id,
      client_id: params.client_id,
      agent_name: params.agent_name,
      interaction_type: params.interaction_type,
      summary: params.summary,
      sentiment_score: params.sentiment_score ?? null,
      metadata: params.metadata || {},
    })
    if (error) {
      console.error('logInteraction insert failed:', error.message)
      return
    }

    // Mirror into RAG so agents can retrieve this person's history by meaning.
    await storeChunk(
      params.client_id,
      `Contact interaction: ${params.summary}`,
      CONTACT_CHUNK_TYPE,
      `contact_${params.contact_id}`
    )
  } catch (e) {
    console.error('logInteraction error:', e)
  }
}

// ── 3. Read history ──────────────────────────────────────────────────────────
export async function getContactHistory(params: {
  client_id: string
  contact_id: string
  limit?: number
}): Promise<Array<{
  agent_name: string
  interaction_type: string
  summary: string
  sentiment_score: number | null
  created_at: string
}>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('contact_interactions')
      .select('agent_name, interaction_type, summary, sentiment_score, created_at')
      .eq('contact_id', params.contact_id)
      .eq('client_id', params.client_id)
      .order('created_at', { ascending: false })
      .limit(params.limit ?? 10)

    if (error) {
      console.error('getContactHistory failed:', error.message)
      return []
    }
    return (data as any[]) || []
  } catch (e) {
    console.error('getContactHistory error:', e)
    return []
  }
}

// ── 4. Adjust score ──────────────────────────────────────────────────────────
// The database applies each tenant-scoped score change atomically.
export async function updateContactScore(params: {
  client_id: string
  contact_id: string
  score_delta: number
}): Promise<void> {
  const { error } = await supabaseAdmin.rpc('adjust_contact_score', {
    p_client_id: params.client_id, p_contact_id: params.contact_id, p_delta: params.score_delta,
  })
  if (error) console.error('[contacts] score update failed:', error.code)
}

// ── Deprecated compatibility shim ────────────────────────────────────────────
// Kept so the previous export name still resolves. The contacts table no longer
// has total_calls / total_reviews / total_invoices / total_invoices_paid, so the
// counter flags are accepted and ignored; only score and status still map.
// Prefer updateContactScore.
export async function updateContactStats(
  contactId: string,
  clientId: string,
  updates: {
    lastContactAt?: string
    scoreChange?: number
    dealStatus?: string
    totalCallsIncrement?: boolean
    totalReviewsIncrement?: boolean
    totalInvoicesIncrement?: boolean
    totalInvoicesPaidIncrement?: boolean
  }
): Promise<void> {
  try {
    const updateData: Record<string, any> = {
      updated_at: updates.lastContactAt || new Date().toISOString(),
    }
    if (updates.dealStatus) updateData.status = updates.dealStatus

    const { error } = await supabaseAdmin
      .from('contacts')
      .update(updateData)
      .eq('id', contactId)
      .eq('client_id', clientId)
    if (error) console.error('updateContactStats failed:', error.message)

    if (updates.scoreChange) {
      await updateContactScore({ client_id: clientId, contact_id: contactId, score_delta: updates.scoreChange })
    }
  } catch (e) {
    console.error('updateContactStats error:', e)
  }
}
