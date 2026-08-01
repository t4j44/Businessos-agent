// Embeddings for the RAG layer, served through OpenRouter.
//
// NOTE ON THE MODEL: CLAUDE.md targets 'google/gemini-embedding-2:free', but
// that model does not exist on OpenRouter (404 "No endpoints found"), and the
// documented fallback 'nvidia/nemotron-3-embed-1b:free' only emits 2048 dims —
// incompatible with rag_chunks.embedding VECTOR(1024). 'baai/bge-m3' returns
// 1024 dims natively, so it matches the schema exactly.
// Other verified 1024-capable options: google/gemini-embedding-001,
// openai/text-embedding-3-small, qwen/qwen3-embedding-8b.

const EMBEDDING_MODEL = 'baai/bge-m3'
const EMBEDDING_DIMS = 1024

export async function createEmbedding(text: string): Promise<number[] | null> {
  if (!process.env.OPENROUTER_API_KEY) return null
  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: [text],
        dimensions: EMBEDDING_DIMS,
      }),
    })
    const data = await response.json()
    const embedding = data.data?.[0]?.embedding
    if (!embedding || embedding.length !== EMBEDDING_DIMS) {
      console.error('Embedding wrong dims:', embedding?.length, data?.error?.message || '')
      return null
    }
    return embedding
  } catch (e) {
    console.error('Embedding failed:', e)
    return null
  }
}

// NOTE: `chunkType` is accepted for call-site clarity but is not yet applied —
// the match_rag_chunks RPC filters only on client_id and is_active. Filtering
// by chunk_type needs a new RPC signature in Supabase.
export async function retrieveContext(
  query: string,
  clientId: string,
  chunkType?: string,
  topK: number = 5
): Promise<string> {
  const { supabaseAdmin } = await import('./supabase')
  const embedding = await createEmbedding(query)
  if (!embedding) return ''

  const { data, error } = await supabaseAdmin.rpc('match_rag_chunks', {
    query_embedding: embedding,
    match_client_id: clientId,
    match_count: topK,
  })

  if (error) {
    console.error('retrieveContext failed:', error.message)
    return ''
  }
  if (!data) return ''
  return data.map((c: any) => c.content).join('\n\n')
}
