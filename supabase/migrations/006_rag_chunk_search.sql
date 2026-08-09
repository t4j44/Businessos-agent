-- RAG chunk provenance + type-filtered similarity search.
--
-- Adds the two columns storeRAGChunk writes (source_agent, metadata), and a
-- search function that returns chunk_type alongside the content and can filter
-- by it. The existing match_rag_chunks from migration 001 returns only
-- (id, content, similarity) and has no chunk_type filter, so it cannot back
-- searchRAGChunks. It is left untouched — retrieveContext still uses it.

ALTER TABLE rag_chunks
  ADD COLUMN IF NOT EXISTS source_agent TEXT,
  ADD COLUMN IF NOT EXISTS metadata     JSONB DEFAULT '{}';

COMMENT ON COLUMN rag_chunks.source_agent IS
  'Which agent produced this chunk, e.g. brand_scout, call_center.';

CREATE INDEX IF NOT EXISTS idx_rag_chunks_client_type
  ON rag_chunks (client_id, chunk_type) WHERE is_active = true;


-- Cosine distance (<=>) turned into a 0..1 similarity, highest first.
-- filter_chunk_type NULL means "any type".
CREATE OR REPLACE FUNCTION search_rag_chunks(
  query_embedding    VECTOR(1024),
  match_client_id    UUID,
  match_count        INT  DEFAULT 5,
  filter_chunk_type  TEXT DEFAULT NULL
)
RETURNS TABLE (
  content    TEXT,
  chunk_type TEXT,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    rag_chunks.content,
    rag_chunks.chunk_type,
    1 - (rag_chunks.embedding <=> query_embedding) AS similarity
  FROM rag_chunks
  WHERE
    rag_chunks.client_id = match_client_id
    AND rag_chunks.is_active = true
    AND rag_chunks.embedding IS NOT NULL
    AND (filter_chunk_type IS NULL OR rag_chunks.chunk_type = filter_chunk_type)
  ORDER BY rag_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;
