-- ============================================================
-- Business OS — Initial Schema
-- Run once in Supabase SQL Editor
-- ============================================================

-- ----------------------------------------
-- 1. Extensions
-- ----------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;


-- ----------------------------------------
-- 2. Tables (foreign-key-safe order)
-- ----------------------------------------

CREATE TABLE clients (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID        NOT NULL,
  name                TEXT        NOT NULL,
  url                 TEXT,
  plan_tier           TEXT        DEFAULT 'starter',
  status              TEXT        DEFAULT 'pending',
  stripe_customer_id  TEXT,
  hubspot_portal_id   TEXT,
  bland_phone_number  TEXT,
  docusign_account_id TEXT,
  google_mybiz_id     TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE brand_profiles (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id           UUID        REFERENCES clients(id) ON DELETE CASCADE,
  company_name        TEXT,
  brand_color_primary TEXT        DEFAULT '#2563EB',   -- used by widget config route
  icp_summary         TEXT,
  tone_description    TEXT,
  products_json       JSONB       DEFAULT '[]',
  brand_colors        TEXT,
  competitors_json    JSONB       DEFAULT '[]',
  greeting_text       TEXT,
  booking_url         TEXT,
  last_scraped_at     TIMESTAMPTZ,
  version             INT         DEFAULT 1
);

CREATE TABLE rag_chunks (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID        REFERENCES clients(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  embedding   VECTOR(1024),
  source_url  TEXT,
  chunk_type  TEXT        DEFAULT 'brand',
  is_active   BOOL        DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE campaigns (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID        REFERENCES clients(id) ON DELETE CASCADE,
  agent_type        TEXT        NOT NULL,
  name              TEXT,
  status            TEXT        DEFAULT 'active',
  settings_json     JSONB       DEFAULT '{}',
  daily_volume_limit INT        DEFAULT 50,
  created_at        TIMESTAMPTZ DEFAULT now(),
  last_run_at       TIMESTAMPTZ
);

CREATE TABLE leads (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID        REFERENCES clients(id) ON DELETE CASCADE,
  email            TEXT,
  name             TEXT,
  company          TEXT,
  linkedin_url     TEXT,
  phone            TEXT,
  phone_consent    BOOL        DEFAULT false,
  apollo_id        TEXT,
  enrichment_json  JSONB       DEFAULT '{}',
  bos_lead_score   INT         DEFAULT 0,
  status           TEXT        DEFAULT 'pending',
  source           TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_runs (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID        REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id    UUID        REFERENCES campaigns(id) ON DELETE SET NULL,
  agent_type     TEXT        NOT NULL,
  status         TEXT        DEFAULT 'pending',
  input_tokens   INT         DEFAULT 0,
  output_tokens  INT         DEFAULT 0,
  cost_usd       FLOAT       DEFAULT 0,
  quality_score  FLOAT,
  output_summary TEXT,
  input_text     TEXT,
  output_text    TEXT,
  metadata       JSONB       DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- UNIQUE on client_id so increment_api_usage can upsert safely
CREATE TABLE api_usage (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID        UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  service     TEXT,
  tokens_in   INT         DEFAULT 0,
  tokens_out  INT         DEFAULT 0,
  tokens_used INT         DEFAULT 0,
  token_limit INT         DEFAULT 100000,
  cost_usd    FLOAT       DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE content_calendar (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID        REFERENCES clients(id) ON DELETE CASCADE,
  platform         TEXT,
  scheduled_at     TIMESTAMPTZ,
  content          TEXT,
  hook             TEXT,
  cta              TEXT,
  status           TEXT        DEFAULT 'draft',
  buffer_update_id TEXT,
  performance_json JSONB       DEFAULT '{}',
  trend_tag        BOOL        DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE bookings (
  id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                   UUID        REFERENCES clients(id) ON DELETE CASCADE,
  contact_id                  TEXT,
  nylas_event_id              TEXT,
  channel                     TEXT,
  scheduled_at                TIMESTAMPTZ,
  duration_min                INT         DEFAULT 30,
  status                      TEXT        DEFAULT 'confirmed',
  qualification_answers_json  JSONB       DEFAULT '{}',
  reminder_sent               BOOL        DEFAULT false,
  show_status                 TEXT,
  created_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE call_transcripts (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID        REFERENCES clients(id) ON DELETE CASCADE,
  contact_id      TEXT,
  bland_call_id   TEXT,
  direction       TEXT,
  agent_type      TEXT,
  duration_sec    INT,
  transcript      TEXT,
  summary         TEXT,
  sentiment_score INT,
  objections_json JSONB       DEFAULT '[]',
  escalated       BOOL        DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE invoices (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID        REFERENCES clients(id) ON DELETE CASCADE,
  contact_id        TEXT,
  stripe_invoice_id TEXT,
  amount_cents      INT,
  status            TEXT        DEFAULT 'sent',
  days_overdue      INT         DEFAULT 0,
  chase_step        INT         DEFAULT 0,
  last_chase_at     TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE reviews (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id          UUID        REFERENCES clients(id) ON DELETE CASCADE,
  platform           TEXT,
  external_review_id TEXT,
  star_rating        INT,
  review_text        TEXT,
  reviewer_name      TEXT,
  review_date        TIMESTAMPTZ,
  responded          BOOL        DEFAULT false,
  response_text      TEXT,
  response_method    TEXT,
  sentiment_score    INT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE weekly_briefs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID        REFERENCES clients(id) ON DELETE CASCADE,
  week_start       DATE,
  ware_score       INT,
  brief_html       TEXT,
  key_metrics_json JSONB       DEFAULT '{}',
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE approvals_queue (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID        REFERENCES clients(id) ON DELETE CASCADE,
  action_type  TEXT,
  payload_json JSONB       DEFAULT '{}',
  status       TEXT        DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ DEFAULT now() + interval '48 hours'
);


-- ----------------------------------------
-- 3. Row Level Security
-- ----------------------------------------
ALTER TABLE clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_chunks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage        ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_briefs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals_queue  ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------
-- 4. RLS Policies
-- ----------------------------------------

-- clients: each user sees only their own row
CREATE POLICY "users_own_clients" ON clients
  FOR ALL USING (user_id = auth.uid());

-- all other tables: visible only if client_id belongs to the calling user
CREATE POLICY "client_isolation" ON brand_profiles
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON rag_chunks
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON campaigns
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON leads
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON agent_runs
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON api_usage
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON content_calendar
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON bookings
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON call_transcripts
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON invoices
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON reviews
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON weekly_briefs
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "client_isolation" ON approvals_queue
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));


-- ----------------------------------------
-- 5. HNSW index for vector similarity search
-- ----------------------------------------
CREATE INDEX ON rag_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Standard btree indexes for common query patterns
CREATE INDEX idx_clients_user_id        ON clients(user_id);
CREATE INDEX idx_leads_client_id        ON leads(client_id);
CREATE INDEX idx_leads_status           ON leads(client_id, status);
CREATE INDEX idx_leads_score            ON leads(client_id, bos_lead_score DESC);
CREATE INDEX idx_agent_runs_client      ON agent_runs(client_id, created_at DESC);
CREATE INDEX idx_agent_runs_type        ON agent_runs(client_id, agent_type);
CREATE INDEX idx_campaigns_client_type  ON campaigns(client_id, agent_type);
CREATE INDEX idx_reviews_client         ON reviews(client_id, review_date DESC);
CREATE INDEX idx_approvals_client       ON approvals_queue(client_id, status);
CREATE INDEX idx_weekly_briefs_client   ON weekly_briefs(client_id, week_start DESC);
CREATE INDEX idx_rag_chunks_client      ON rag_chunks(client_id, is_active);


-- ----------------------------------------
-- 6. match_rag_chunks RPC
--    Called by /api/widget/chat to retrieve
--    the top-k most relevant knowledge chunks
-- ----------------------------------------
CREATE OR REPLACE FUNCTION match_rag_chunks(
  query_embedding  VECTOR(1024),
  match_client_id  UUID,
  match_count      INT DEFAULT 5
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rag_chunks.id,
    rag_chunks.content,
    1 - (rag_chunks.embedding <=> query_embedding) AS similarity
  FROM rag_chunks
  WHERE
    rag_chunks.client_id = match_client_id
    AND rag_chunks.is_active = true
  ORDER BY rag_chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- ----------------------------------------
-- 7. increment_api_usage RPC
--    Called by /api/widget/chat after each
--    Claude response to track token spend
-- ----------------------------------------
CREATE OR REPLACE FUNCTION increment_api_usage(
  p_client_id UUID,
  p_tokens    INT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO api_usage (client_id, tokens_used, token_limit)
  VALUES (p_client_id, p_tokens, 100000)
  ON CONFLICT (client_id)
  DO UPDATE SET tokens_used = api_usage.tokens_used + p_tokens;
END;
$$;


-- ----------------------------------------
-- 8. Service-role bypass policies
--    Allow the server-side Supabase client
--    (SUPABASE_SERVICE_ROLE_KEY) to read
--    brand_profiles and clients without auth
--    — needed by the public widget endpoints
-- ----------------------------------------
CREATE POLICY "service_role_read" ON brand_profiles
  FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY "service_role_read" ON clients
  FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY "service_role_read" ON api_usage
  FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY "service_role_insert" ON api_usage
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_update" ON api_usage
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "service_role_insert" ON agent_runs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_read" ON rag_chunks
  FOR SELECT USING (auth.role() = 'service_role');
