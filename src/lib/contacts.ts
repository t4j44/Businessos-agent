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
  if (!params.email && !params.phone) return null

  try {
    // Email first — it is the stronger identifier when both are present.
    if (params.email) {
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .select('id, score, status')
        .eq('client_id', params.client_id)
        .eq('email', params.email)
        .maybeSingle()
      if (error) {
        console.error('findOrCreateContact email lookup failed:', error.message)
        return null
      }
      if (data) return data as ContactRef
    }

    if (params.phone) {
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .select('id, score, status')
        .eq('client_id', params.client_id)
        .eq('phone', params.phone)
        .maybeSingle()
      if (error) {
        console.error('findOrCreateContact phone lookup failed:', error.message)
        return null
      }
      if (data) return data as ContactRef
    }

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        client_id: params.client_id,
        email: params.email || null,
        phone: params.phone || null,
        name: params.name || null,
        source: params.source || null,
        score: 0,
        status: 'active',
      })
      .select('id, score, status')
      .single()

    if (error) {
      console.error('findOrCreateContact insert failed:', error.message)
      return null
    }
    return data as ContactRef
  } catch (e) {
    console.error('findOrCreateContact error:', e)
    return null
  }
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
// Read-modify-write as specified. Note this is not atomic: two interactions
// landing at the same moment can each read the same starting score and one
// delta is lost. Fine at current volume; if it matters later, move the clamp
// into a Postgres function and call it via rpc().
export async function updateContactScore(params: {
  contact_id: string
  score_delta: number
}): Promise<void> {
  try {
    const { data, error: readError } = await supabaseAdmin
      .from('contacts')
      .select('score')
      .eq('id', params.contact_id)
      .maybeSingle()

    if (readError) {
      console.error('updateContactScore read failed:', readError.message)
      return
    }
    if (!data) {
      console.error('updateContactScore: contact not found:', params.contact_id)
      return
    }

    const current = Number(data.score) || 0
    const next = Math.max(SCORE_MIN, Math.min(SCORE_MAX, current + params.score_delta))

    const { error: writeError } = await supabaseAdmin
      .from('contacts')
      .update({ score: next, updated_at: new Date().toISOString() })
      .eq('id', params.contact_id)

    if (writeError) {
      console.error('updateContactScore write failed:', writeError.message)
    }
  } catch (e) {
    console.error('updateContactScore error:', e)
  }
}

// ── Deprecated compatibility shim ────────────────────────────────────────────
// Kept so the previous export name still resolves. The contacts table no longer
// has total_calls / total_reviews / total_invoices / total_invoices_paid, so the
// counter flags are accepted and ignored; only score and status still map.
// Prefer updateContactScore.
export async function updateContactStats(
  contactId: string,
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
    if (error) console.error('updateContactStats failed:', error.message)

    if (updates.scoreChange) {
      await updateContactScore({ contact_id: contactId, score_delta: updates.scoreChange })
    }
  } catch (e) {
    console.error('updateContactStats error:', e)
  }
}
