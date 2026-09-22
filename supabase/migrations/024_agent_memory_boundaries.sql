BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.widget_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (length(content) <= 3000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS widget_message_history ON public.widget_messages(client_id, session_key, created_at DESC, id DESC);
ALTER TABLE public.widget_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.widget_messages FROM anon, authenticated;
GRANT ALL ON public.widget_messages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.widget_messages_id_seq TO service_role;
ALTER TABLE public.rag_chunks ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'internal'
  CHECK (visibility IN ('internal', 'public'));
ALTER TABLE public.rag_chunks ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.rag_chunks ADD COLUMN IF NOT EXISTS approved_by uuid;
-- Existing content remains internal until the business owner reviews it.
CREATE INDEX IF NOT EXISTS rag_public_knowledge ON public.rag_chunks(client_id, chunk_type)
  WHERE is_active AND visibility = 'public';

CREATE OR REPLACE FUNCTION public.search_public_knowledge(
  query_embedding vector(1024), match_client_id uuid, match_count integer DEFAULT 5
) RETURNS TABLE(content text, chunk_type text, similarity float)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
  SELECT c.content, c.chunk_type, 1 - (c.embedding <=> query_embedding)
  FROM public.rag_chunks c
  WHERE c.client_id = match_client_id AND c.is_active AND c.embedding IS NOT NULL
    AND c.visibility = 'public' AND c.approved_at IS NOT NULL
    AND c.chunk_type IN ('brand', 'faq', 'policy', 'service', 'knowledge')
  ORDER BY c.embedding <=> query_embedding LIMIT least(greatest(match_count, 1), 10);
$$;
REVOKE ALL ON FUNCTION public.search_public_knowledge(vector, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_public_knowledge(vector, uuid, integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.agent_rate_limits (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  agent text NOT NULL,
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, agent, subject, window_start)
);
ALTER TABLE public.agent_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_rate_limits FROM anon, authenticated;
GRANT ALL ON public.agent_rate_limits TO service_role;
ALTER TABLE public.api_usage ADD COLUMN IF NOT EXISTS period_start date NOT NULL DEFAULT date_trunc('month', now())::date;
REVOKE INSERT, UPDATE, DELETE ON public.api_usage FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_agent_quota(
  p_client_id uuid, p_agent text, p_subject text, p_hourly_limit integer,
  p_subject_limit integer, p_reserved_tokens integer DEFAULT 0
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  hour_start timestamptz := date_trunc('hour', now());
  month_start date := date_trunc('month', now())::date;
  tenant_hits integer;
  subject_hits integer;
  usage public.api_usage;
BEGIN
  IF p_client_id IS NULL OR length(p_agent) NOT BETWEEN 1 AND 80
    OR length(p_subject) NOT BETWEEN 1 AND 160 OR p_subject = '*'
    OR p_hourly_limit NOT BETWEEN 1 AND 10000 OR p_subject_limit NOT BETWEEN 1 AND 1000
    OR p_reserved_tokens NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'Invalid quota input' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('quota:' || p_client_id::text, 0));
  -- Bounded per-tenant retention; cleanup never touches another tenant.
  DELETE FROM public.agent_rate_limits WHERE client_id = p_client_id AND window_start < hour_start - interval '2 hours';
  SELECT hits INTO tenant_hits FROM public.agent_rate_limits
    WHERE client_id = p_client_id AND agent = p_agent AND subject = '*' AND window_start = hour_start;
  SELECT hits INTO subject_hits FROM public.agent_rate_limits
    WHERE client_id = p_client_id AND agent = p_agent AND subject = p_subject AND window_start = hour_start;
  IF coalesce(tenant_hits, 0) >= p_hourly_limit OR coalesce(subject_hits, 0) >= p_subject_limit THEN RETURN false; END IF;
  IF p_reserved_tokens > 0 THEN
    INSERT INTO public.api_usage(client_id, tokens_used, token_limit, period_start)
      VALUES(p_client_id, 0, 100000, month_start) ON CONFLICT (client_id) DO NOTHING;
    SELECT * INTO usage FROM public.api_usage WHERE client_id = p_client_id FOR UPDATE;
    IF usage.period_start < month_start THEN
      UPDATE public.api_usage SET tokens_used = 0, period_start = month_start WHERE client_id = p_client_id;
      usage.tokens_used := 0;
    END IF;
    IF usage.token_limit IS NULL OR coalesce(usage.tokens_used, 0) + p_reserved_tokens > usage.token_limit THEN RETURN false; END IF;
    UPDATE public.api_usage SET tokens_used = coalesce(tokens_used, 0) + p_reserved_tokens WHERE client_id = p_client_id;
  END IF;
  INSERT INTO public.agent_rate_limits(client_id, agent, subject, window_start, hits)
    VALUES(p_client_id, p_agent, '*', hour_start, 1), (p_client_id, p_agent, p_subject, hour_start, 1)
    ON CONFLICT (client_id, agent, subject, window_start) DO UPDATE SET hits = agent_rate_limits.hits + 1;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_agent_quota(uuid, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_agent_quota(uuid, text, text, integer, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_agent_quota(p_client_id uuid, p_reserved_tokens integer, p_actual_tokens integer, p_period date)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.api_usage SET tokens_used = greatest(0, tokens_used - greatest(0, p_reserved_tokens - p_actual_tokens))
  WHERE client_id = p_client_id AND period_start = p_period
    AND p_reserved_tokens BETWEEN 1 AND 100000 AND p_actual_tokens >= 0;
$$;
REVOKE ALL ON FUNCTION public.settle_agent_quota(uuid, integer, integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_agent_quota(uuid, integer, integer, date) TO service_role;

-- No direct browser writes to sensitive system-managed records. Tenant read
-- policies remain; the authenticated API is the write boundary.
REVOKE INSERT, UPDATE, DELETE ON public.agent_runs, public.call_transcripts,
  public.invoices, public.unsubscribe_tokens, public.suppression_list FROM anon, authenticated;
COMMIT;
