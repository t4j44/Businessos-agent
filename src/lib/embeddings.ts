// Embeddings for the RAG layer, served through OpenRouter. Server-side only —
// OPENROUTER_API_KEY is not a NEXT_PUBLIC_ variable, so nothing here can run in
// the browser, and this module carries no client directive.
//
// NOTE ON THE MODEL ID: the id is lowercase 'baai/bge-m3'. OpenRouter model ids
// are lowercase ('anthropic/claude-sonnet-5', 'meta-llama/llama-3.3-70b-instruct');
// 'BAAI/bge-m3' is the HuggingFace spelling and 404s here.
//
// CLAUDE.md targets 'google/gemini-embedding-2:free', but that model does not
// exist on OpenRouter, and the documented fallback 'nvidia/nemotron-3-embed-1b:free'
// emits 2048 dims — incompatible with rag_chunks.embedding VECTOR(1024).
// 'baai/bge-m3' returns 1024 natively. Other verified 1024-capable options:
// google/gemini-embedding-001, openai/text-embedding-3-small, qwen/qwen3-embedding-8b.

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
  if (embedding.length !== EMBEDDING_DIMS) {
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
export async function storeRAGChunk(params: {
  client_id: string
  content: string
  chunk_type: string
  source_agent: string
  metadata?: Record<string, unknown>
}): Promise<void> {
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
    }
  } catch (e: any) {
    console.error('storeRAGChunk failed:', e?.message || e)
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
      filter_chunk_type: params.chunk_type ?? null,
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

// NOTE: `chunkType` is accepted but deliberately NOT applied. Its two callers
// pass 'faq' and 'voice', and no agent writes chunk_type='faq' — honouring the
// filter here would silently drop call-center's context to nothing. Use
// searchRAGChunks when you want real type filtering.
export async function retrieveContext(
  query: string,
  clientId: string,
  chunkType?: string,
  topK: number = 5
): Promise<string> {
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
      filter_chunk_type: chunkType ?? null,
    })

    if (!error && data) {
      return data.map((c: any) => c.content).join('\n\n')
    }

    // Fall back to the original function if 006 has not been applied. The type
    // filter is lost in that case, which is the previous behaviour.
    if (error) {
      console.warn('[rag] search_rag_chunks unavailable, falling back:', error.message)
    }
    const { data: legacy, error: legacyError } = await supabaseAdmin.rpc('match_rag_chunks', {
      query_embedding: embedding,
      match_client_id: clientId,
      match_count: topK,
    })
    if (legacyError || !legacy) return ''
    return legacy.map((c: any) => c.content).join('\n\n')
  } catch (e) {
    console.error('RAG retrieval failed:', e)
    return ''
  }
}

export async function storeChunk(
  clientId: string,
  content: string,
  chunkType: string,
  sourceUrl?: string
): Promise<boolean> {
  if (!content || content.trim().length < 50) return false
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
