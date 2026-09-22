// Embeddings for the RAG layer, served through OpenRouter. Server-side only —
// OPENROUTER_API_KEY is not a NEXT_PUBLIC_ variable, so nothing here can run in
// the browser, and this module carries no client directive.
//
// The existing database was embedded with baai/bge-m3. Keep that vector space
// until a versioned reindex is complete. The requested Gemini free variant and
// provider availability require verification; matching dimensions alone do not
// make embeddings from different models comparable.

import { supabaseAdmin } from './supabase'

const EMBEDDING_MODEL = 'baai/bge-m3'
const EMBEDDING_DIMS = 1024
const EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings'

// ── Core: throws ─────────────────────────────────────────────────────────────
// The strict variant. Use this when a caller needs to know why embedding failed.
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      'OPENROUTER_API_KEY is missing — add it to .env.local (and to your Vercel project env for deploys).'
    )
  }

  let res: Response
  try {
    res = await fetch(EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: [text],
        // Required by CLAUDE.md: rag_chunks.embedding is VECTOR(1024).
        dimensions: EMBEDDING_DIMS,
      }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e: any) {
    throw new Error(`Embedding request to OpenRouter failed: ${e?.message || String(e)}`)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `OpenRouter embeddings returned ${res.status} for model '${EMBEDDING_MODEL}': ${detail.slice(0, 300)}`
    )
  }

  const data = await res.json()
  const embedding = data?.data?.[0]?.embedding

  if (!Array.isArray(embedding)) {
    throw new Error(
      `OpenRouter embeddings returned no vector: ${JSON.stringify(data).slice(0, 300)}`
    )
  }
  if (embedding.length !== EMBEDDING_DIMS || !embedding.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error(
      `Embedding has ${embedding.length} dimensions, expected ${EMBEDDING_DIMS} — rag_chunks.embedding is VECTOR(${EMBEDDING_DIMS}) and will reject this.`
    )
  }

  return embedding
}

// ── Tolerant wrapper: returns null ───────────────────────────────────────────
// Existing callers (brand-scout, storeChunk) treat a failed embedding as a skip
// rather than an error, so this keeps that contract instead of duplicating the
// fetch logic.
export async function createEmbedding(text: string): Promise<number[] | null> {
  try {
    return await generateEmbedding(text)
  } catch (e: any) {
    console.error('createEmbedding failed:', e?.message || e)
    return null
  }
}

// ── Store ────────────────────────────────────────────────────────────────────
/**
 * Returns true only when a row was actually inserted.
 *
 * It used to return void and swallow both failure modes, so callers counted
 * attempts and reported them as stores — brand-scout logged "stored 3
 * structured chunks" while rag_chunks stayed empty.
 */
export async function storeRAGChunk(params: {
  client_id: string
  content: string
  chunk_type: string
  source_agent: string
  metadata?: Record<string, unknown>
}): Promise<boolean> {
  try {
    const embedding = await generateEmbedding(params.content)

    const { error } = await supabaseAdmin.from('rag_chunks').insert({
      client_id: params.client_id,
      content: params.content,
      embedding,
      chunk_type: params.chunk_type,
      source_agent: params.source_agent,
      metadata: params.metadata || {},
      is_active: true,
    })

    if (error) {
      console.error('storeRAGChunk insert failed:', error.message)
      return false
    }
    return true
  } catch (e: any) {
    console.error('storeRAGChunk failed:', e?.message || e)
    return false
  }
}

// ── Search ───────────────────────────────────────────────────────────────────
export async function searchRAGChunks(params: {
  client_id: string
  query: string
  limit?: number
  chunk_type?: string
}): Promise<Array<{ content: string; chunk_type: string; similarity: number }>> {
  try {
    const embedding = await generateEmbedding(params.query)

    // search_rag_chunks (migration 006) returns chunk_type and honours the type
    // filter. The older match_rag_chunks returns neither.
    const { data, error } = await supabaseAdmin.rpc('search_rag_chunks', {
      query_embedding: embedding,
      match_client_id: params.client_id,
      match_count: params.limit ?? 5,
      filter_chunk_type: params.chunk_type ?? 'brand',
    })

    if (error) {
      console.error('searchRAGChunks failed:', error.message)
      return []
    }

    return (data || []).map((row: any) => ({
      content: row.content,
      chunk_type: row.chunk_type,
      similarity: Number(row.similarity),
    }))
  } catch (e: any) {
    console.error('searchRAGChunks failed:', e?.message || e)
    return []
  }
}

// ── Existing helpers, unchanged behaviour ────────────────────────────────────

// Each caller explicitly selects a knowledge domain; no broad fallback.
export async function retrieveContext(
  query: string,
  clientId: string,
  chunkType?: string,
  topK: number = 5
): Promise<string> {
  // Customer history requires an explicit contact + tenant lookup. External
  // research must be requested by type and never competes with brand facts.
  if (chunkType === 'contact') return ''
  const embedding = await createEmbedding(query)
  if (!embedding) return ''
  try {
    // search_rag_chunks (migration 006) is the only one of the two that honours
    // a type filter — match_rag_chunks ignores it entirely, so passing chunkType
    // to the older function was a silent no-op.
    const { data, error } = await supabaseAdmin.rpc('search_rag_chunks', {
      query_embedding: embedding,
      match_client_id: clientId,
      match_count: topK,
      filter_chunk_type: chunkType ?? 'brand',
    })

    if (!error && data) {
      return data.map((c: any) => c.content).join('\n\n')
    }

    // A missing migration must never broaden retrieval into customer history.
    if (error) console.warn('[rag] typed retrieval unavailable:', error.code)
    return ''
  } catch (e) {
    console.error('RAG retrieval failed:', e)
    return ''
  }
}

export async function retrievePublicKnowledge(query: string, clientId: string): Promise<string> {
  const embedding = await createEmbedding(query)
  if (!embedding) return ''
  const { data, error } = await supabaseAdmin.rpc('search_public_knowledge', {
    query_embedding: embedding, match_client_id: clientId, match_count: 5,
  })
  if (error) throw new Error('Approved knowledge is temporarily unavailable.')
  return (data || []).map((row: { content: string }) => row.content).join('\n\n').slice(0, 8000)
}

export async function storeChunk(
  clientId: string,
  content: string,
  chunkType: string,
  sourceUrl?: string
): Promise<boolean> {
  if (!content || !content.trim()) return false
  try {
    const embedding = await createEmbedding(content)
    // A null embedding would insert a row that similarity search can never
    // return, quietly padding rag_chunks with dead rows.
    if (!embedding) {
      console.error('storeChunk: no embedding produced, skipping insert')
      return false
    }
    const { error } = await supabaseAdmin.from('rag_chunks').insert({
      client_id: clientId,
      content: content.trim(),
      embedding,
      chunk_type: chunkType,
      source_url: sourceUrl || null,
      is_active: true,
    })
    if (error) {
      console.error('Chunk store failed:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('storeChunk error:', e)
    return false
  }
}
