# Business OS

## FOUNDATION FILES
Reuse these — do not recreate them.

- `src/lib/ai.ts` — `callAI`, `MODELS`, `parseJSON`. `ACTIVE_MODEL` is the one
  line that swaps the model everywhere; `COSTS` falls back to zero-cost for any
  model not listed.
- `src/lib/supabase.ts` — `supabaseAdmin` (service role, bypasses RLS) and
  `getClientContext(clientId)` → `{ client, brand }`.
- `src/lib/log.ts` — `logAgentRun({ client_id, agent_type, status, ... })`.
- `src/lib/scraper.ts` — `readWebsite(url, maxChars)`. Crawl4AI first when
  `CRAWL4AI_URL` is set, Jina Reader (no API key) as the fallback.

## EMBEDDINGS (for Piece 3 / RAG)
- OpenRouter DOES support embeddings — 27 models available
- Use via the same OPENROUTER_API_KEY, different endpoint:
  POST https://openrouter.ai/api/v1/embeddings
  Body: { model: 'google/gemini-embedding-2:free', input: [text] }
- Target model: 'google/gemini-embedding-2:free' (free, flexible dims)
- IMPORTANT: rag_chunks table uses VECTOR(1024) — embeddings must be
  1024 dimensions. When calling the API, set dimensions: 1024 in the body.
- Fallback: if Gemini Embedding returns wrong dims, switch to
  'nvidia/nemotron-3-embed-1b:free' which also supports 1024.
