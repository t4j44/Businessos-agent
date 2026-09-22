-- ═══════════════════════════════════════════════════════════════════════════
-- 022 — FULL CATCH-UP
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The live database and supabase/migrations/ have drifted apart more than once.
-- 004 caught up four tables from 001. 021 caught up four more from 001/010/012.
-- Then /dashboard/settings failed live with
--
--     column clients.contact_name does not exist
--
-- which is migration 003 — a file that has sat in this repo since the settings
-- page was built and was never run. There is no migration runner in this
-- project; every file is pasted into the Supabase SQL Editor by hand, so
-- "committed" and "applied" are independent facts.
--
-- This file therefore does NOT try to be a minimal diff. It restates every
-- object migrations 001-021 create, defensively, so that running it once brings
-- the database to the state the repo expects regardless of which earlier files
-- were actually executed.
--
-- SAFETY
-- ------
--  * Every statement is idempotent: CREATE TABLE IF NOT EXISTS,
--    ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--    CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS before CREATE POLICY.
--  * There is no DROP TABLE, no DROP COLUMN, no TRUNCATE, no DELETE.
--  * Objects that depend on a table which may not exist are wrapped in a
--    to_regclass() guard. Migration 018 failed live precisely because it did
--    ALTER TABLE contacts without one.
--  * Safe to run twice. On a database where everything already applied it is a
--    no-op.
--
-- ORDER: extensions -> tables -> columns -> data normalisation -> constraints
--        -> indexes -> functions -> RLS -> policies -> storage.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 0. EXTENSIONS  (001, 019)
--
-- Wrapped so a restricted role that cannot CREATE EXTENSION raises a notice
-- instead of aborting the whole script. On Supabase these all succeed.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'uuid-ossp not available: %', SQLERRM; END;
  BEGIN CREATE EXTENSION IF NOT EXISTS pgcrypto;    EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgcrypto not available: %', SQLERRM; END;
  BEGIN CREATE EXTENSION IF NOT EXISTS vector;      EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'vector not available: %', SQLERRM; END;
  BEGIN CREATE EXTENSION IF NOT EXISTS pg_trgm;     EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm not available: %', SQLERRM; END;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 1. TABLES  (001, 004, 005, 010, 011, 012, 018, 019, 021)
--
-- gen_random_uuid() rather than uuid_generate_v4(): pgcrypto ships with
-- PostgreSQL 13+, uuid-ossp may not be enabled. Same value, fewer assumptions.
-- Column types and defaults otherwise match the source migrations exactly.
-- ───────────────────────────────────────────────────────────────────────────

-- ── clients (001, with user_id already nullable per 002) ───────────────────
CREATE TABLE IF NOT EXISTS clients (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID,
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

CREATE TABLE IF NOT EXISTS brand_profiles (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID        REFERENCES clients(id) ON DELETE CASCADE,
  company_name        TEXT,
  brand_color_primary TEXT,
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

CREATE TABLE IF NOT EXISTS rag_chunks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        REFERENCES clients(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  embedding   VECTOR(1024),
  source_url  TEXT,
  chunk_type  TEXT        DEFAULT 'brand',
  is_active   BOOL        DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID        REFERENCES clients(id) ON DELETE CASCADE,
  agent_type         TEXT        NOT NULL,
  name               TEXT,
  status             TEXT        DEFAULT 'active',
  settings_json      JSONB       DEFAULT '{}',
  daily_volume_limit INT         DEFAULT 50,
  created_at         TIMESTAMPTZ DEFAULT now(),
  last_run_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS leads (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID        REFERENCES clients(id) ON DELETE CASCADE,
  email             TEXT,
  name              TEXT,
  company           TEXT,
  linkedin_url      TEXT,
  phone             TEXT,
  phone_consent     BOOL        DEFAULT false,
  apollo_id         TEXT,
  enrichment_json   JSONB       DEFAULT '{}',
  bos_lead_score    INT         DEFAULT 0,
  status            TEXT        DEFAULT 'pending',
  source            TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- UNIQUE on client_id so increment_api_usage can upsert safely.
CREATE TABLE IF NOT EXISTS api_usage (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  service     TEXT,
  tokens_in   INT         DEFAULT 0,
  tokens_out  INT         DEFAULT 0,
  tokens_used INT         DEFAULT 0,
  token_limit INT         DEFAULT 100000,
  cost_usd    FLOAT       DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_calendar (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- Nylas-backed calendar record. Deliberately distinct from `appointments`.
CREATE TABLE IF NOT EXISTS bookings (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                  UUID        REFERENCES clients(id) ON DELETE CASCADE,
  contact_id                 TEXT,
  nylas_event_id             TEXT,
  channel                    TEXT,
  scheduled_at               TIMESTAMPTZ,
  duration_min               INT         DEFAULT 30,
  status                     TEXT        DEFAULT 'confirmed',
  qualification_answers_json JSONB       DEFAULT '{}',
  reminder_sent              BOOL        DEFAULT false,
  show_status                TEXT,
  created_at                 TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_transcripts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE TABLE IF NOT EXISTS invoices (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE TABLE IF NOT EXISTS reviews (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE TABLE IF NOT EXISTS weekly_briefs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID        REFERENCES clients(id) ON DELETE CASCADE,
  week_start       DATE,
  ware_score       INT,
  brief_html       TEXT,
  key_metrics_json JSONB       DEFAULT '{}',
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals_queue (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID        REFERENCES clients(id) ON DELETE CASCADE,
  action_type  TEXT,
  payload_json JSONB       DEFAULT '{}',
  status       TEXT        DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ DEFAULT now() + interval '48 hours'
);

-- ── 005 — contact intelligence ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID        REFERENCES clients(id) ON DELETE CASCADE,
  email      TEXT,
  phone      TEXT,
  name       TEXT,
  source     TEXT,
  score      INT         DEFAULT 0,
  status     TEXT        DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_interactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id       UUID        REFERENCES contacts(id) ON DELETE CASCADE,
  client_id        UUID        REFERENCES clients(id) ON DELETE CASCADE,
  agent_name       TEXT        NOT NULL,
  interaction_type TEXT        NOT NULL,
  summary          TEXT,
  sentiment_score  INT,
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── 010 — widget sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS widget_sessions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              UUID        REFERENCES clients(id) ON DELETE CASCADE,
  session_token          TEXT        NOT NULL,
  visitor_classification TEXT,
  message_count          INT         DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

-- ── 012 — appointments ────────────────────────────────────────────────────
-- requested_time is TEXT, not TIME, on purpose: booking forms submit "2:30pm",
-- "afternoon", "after 5". The reminder cron filters on requested_date, which IS
-- typed, so nothing depends on parsing the time.
CREATE TABLE IF NOT EXISTS appointments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID        REFERENCES clients(id) ON DELETE CASCADE,
  customer_name  TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  requested_date DATE,
  requested_time TEXT,
  service_type   TEXT,
  status         TEXT        DEFAULT 'pending',
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  confirmed_date DATE,
  confirmed_time TEXT,
  reminder_sent  BOOL        DEFAULT false,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- ── 018 — compliance ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppression_list (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID        REFERENCES clients(id) ON DELETE CASCADE,
  channel    TEXT        NOT NULL CHECK (channel IN ('email', 'sms')),
  -- Lower-cased email address or E.164 phone number.
  address    TEXT        NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS unsubscribe_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token      TEXT        NOT NULL UNIQUE,
  client_id  UUID        REFERENCES clients(id) ON DELETE CASCADE,
  channel    TEXT        NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
  address    TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  used_at    TIMESTAMPTZ
);

-- ── 019 — Overture Maps Places (CDLA Permissive 2.0 reference data) ────────
CREATE TABLE IF NOT EXISTS overture_places (
  overture_id TEXT PRIMARY KEY,
  name        TEXT,
  category    TEXT,
  website     TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  postcode    TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  -- Overture's own 0-1 confidence in the record. The ETL filters below 0.6.
  confidence  REAL,
  created_at  TIMESTAMPTZ DEFAULT now()
);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. COLUMNS ADDED BY LATER MIGRATIONS
--
-- Every table referenced below is created above in this same file, so these
-- ALTERs cannot hit a missing table.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 002 — onboarding fields on clients ────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS industry      TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- 001 declared user_id NOT NULL; onboarding could not satisfy that before auth
-- existed. No-op when the column is already nullable.
ALTER TABLE clients ALTER COLUMN user_id DROP NOT NULL;

-- ── 003 — settings-page persistence  <<< THE ONE THAT WAS NEVER APPLIED ────
-- "column clients.contact_name does not exist" came from here.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS timezone      TEXT  DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS settings_json JSONB DEFAULT '{}';

COMMENT ON COLUMN clients.settings_json IS
  'Per-client preferences, currently { notifications: { <key>: boolean } }.';

-- ── 006 — RAG chunk provenance ────────────────────────────────────────────
ALTER TABLE rag_chunks
  ADD COLUMN IF NOT EXISTS source_agent TEXT,
  ADD COLUMN IF NOT EXISTS metadata     JSONB DEFAULT '{}';

COMMENT ON COLUMN rag_chunks.source_agent IS
  'Which agent produced this chunk, e.g. brand_scout, call_center.';

-- ── 007 — Brand DNA fields ────────────────────────────────────────────────
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS tagline      TEXT,
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS contact_info JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS location     TEXT;

-- NOT IN ANY MIGRATION ON DISK, but written by /api/onboarding/analyze,
-- brand-scout, /api/my-business and /api/onboarding/update. 001 declares
-- brand_profiles without them, so an insert naming them fails outright — which
-- is one way a "successful" Brand Scout run still leaves an empty profile.
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS tone_type         TEXT,
  ADD COLUMN IF NOT EXISTS value_proposition TEXT,
  ADD COLUMN IF NOT EXISTS pain_points_json  JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS faq_json          JSONB DEFAULT '[]';

-- ── 010 — widget branding ─────────────────────────────────────────────────
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- ── 014 — visual brand fields ─────────────────────────────────────────────
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS brand_color_secondary TEXT,
  ADD COLUMN IF NOT EXISTS brand_color_accent    TEXT,
  ADD COLUMN IF NOT EXISTS brand_font_primary    TEXT,
  ADD COLUMN IF NOT EXISTS brand_font_secondary  TEXT,
  ADD COLUMN IF NOT EXISTS visual_style          TEXT,
  ADD COLUMN IF NOT EXISTS photography_style     TEXT,
  ADD COLUMN IF NOT EXISTS existing_image_urls   TEXT[];

-- 001 gave brand_color_primary DEFAULT '#2563EB', which defeats "keep the
-- founder's colour if one is already set" — every row has a value the moment it
-- is inserted. Dropping the default makes "never set" expressible. Existing
-- rows are untouched; the widget config route already falls back to '#2563EB'.
ALTER TABLE brand_profiles ALTER COLUMN brand_color_primary DROP DEFAULT;

-- ── 009 — invoice customer + due date ─────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_name  TEXT,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS due_date       DATE;

-- ── 011 — content calendar ────────────────────────────────────────────────
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS post_date DATE;

-- ── 012 — appointments (restated for older shapes of the table) ───────────
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS confirmed_date DATE,
  ADD COLUMN IF NOT EXISTS confirmed_time TEXT,
  ADD COLUMN IF NOT EXISTS reminder_sent  BOOL        DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT now();

-- ── 015 — Nightwatch synthesis on the weekly brief ────────────────────────
ALTER TABLE weekly_briefs
  ADD COLUMN IF NOT EXISTS intelligence_report_json JSONB;

-- ── 016 / 017 / 019 / 020 — Hunter lead pipeline ──────────────────────────
ALTER TABLE leads
  -- 016: Overture/Places discovery
  ADD COLUMN IF NOT EXISTS place_id         TEXT,
  ADD COLUMN IF NOT EXISTS website          TEXT,
  ADD COLUMN IF NOT EXISTS address          TEXT,
  ADD COLUMN IF NOT EXISTS city             TEXT,
  ADD COLUMN IF NOT EXISTS category         TEXT,
  ADD COLUMN IF NOT EXISTS rating           NUMERIC,
  ADD COLUMN IF NOT EXISTS review_count     INT,
  ADD COLUMN IF NOT EXISTS prospect_query   TEXT,
  ADD COLUMN IF NOT EXISTS outreach_status  TEXT DEFAULT 'new',
  -- 017: enrichment results
  ADD COLUMN IF NOT EXISTS email_found      TEXT,
  ADD COLUMN IF NOT EXISTS email_confidence INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_source     TEXT,
  ADD COLUMN IF NOT EXISTS icp_match_score  INT,
  ADD COLUMN IF NOT EXISTS icp_match_reason TEXT,
  ADD COLUMN IF NOT EXISTS pain_points      JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT now(),
  -- 019: the ICP scoring prompt reads city AND state
  ADD COLUMN IF NOT EXISTS state            TEXT,
  -- 020: a named human to write to, so cold email does not open
  --      "Hi Austin Dental Care,"
  ADD COLUMN IF NOT EXISTS contact_name     TEXT,
  ADD COLUMN IF NOT EXISTS contact_role     TEXT;

-- ── 018 — consent provenance (TCPA / CAN-SPAM) ────────────────────────────
-- leads.phone_consent exists from 001, but nothing recorded WHEN or WHERE
-- consent came from, which is what TCPA actually requires you to be able to
-- show.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email_consent        BOOL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_consent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_consent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_consent_source TEXT;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_consent        BOOL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_consent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_consent        BOOL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_consent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_consent_source TEXT;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. DATA NORMALISATION + CHECK CONSTRAINTS  (011, 012)
--
-- These UPDATEs are the only statements in this file that write data. Both are
-- copied from the migration they catch up, and both exist because the CHECK
-- constraint below them cannot be added while an out-of-range value is present.
-- Neither deletes anything.
-- ───────────────────────────────────────────────────────────────────────────

-- 011: post_date is the calendar day a post belongs to, independent of send
-- time. Backfilled so existing rows sort alongside newly generated ones.
UPDATE content_calendar
   SET post_date = scheduled_at::date
 WHERE post_date IS NULL
   AND scheduled_at IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_calendar_status_check'
  ) THEN
    UPDATE content_calendar
       SET status = 'draft'
     WHERE status IS NULL
        OR status NOT IN ('draft', 'approved', 'published', 'scheduled', 'rejected');

    ALTER TABLE content_calendar
      ADD CONSTRAINT content_calendar_status_check
      CHECK (status IN ('draft', 'approved', 'published', 'scheduled', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_status_check'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_status_check
      CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed'));
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. INDEXES  (001, 004, 005, 006, 007, 009, 010, 011, 012, 015, 016, 017,
--              018, 019)
--
-- 001 created several of these unnamed (CREATE INDEX ON ...), so Postgres
-- generated names like rag_chunks_embedding_idx. IF NOT EXISTS matches on name,
-- not definition, so a differently-named equivalent would be built a second
-- time. The HNSW index is therefore guarded on the access method instead — a
-- duplicate HNSW index over a vector column is expensive, not merely redundant.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class c  ON c.oid  = i.indexrelid
      JOIN pg_am    am ON am.oid = c.relam
     WHERE i.indrelid = 'rag_chunks'::regclass
       AND am.amname  = 'hnsw'
  ) THEN
    CREATE INDEX idx_rag_chunks_embedding_hnsw
      ON rag_chunks USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- e.g. the vector extension is unavailable. Retrieval still works without the
  -- index, just sequentially.
  RAISE NOTICE 'HNSW index on rag_chunks skipped: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_user_id       ON clients (user_id);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_client     ON rag_chunks (client_id, is_active);
CREATE INDEX IF NOT EXISTS idx_agent_runs_client     ON agent_runs (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_type       ON agent_runs (client_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_campaigns_client_type ON campaigns (client_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_reviews_client        ON reviews (client_id, review_date DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_client      ON approvals_queue (client_id, status);
CREATE INDEX IF NOT EXISTS idx_weekly_briefs_client  ON weekly_briefs (client_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_client       ON bookings (client_id, scheduled_at DESC);

-- 004
CREATE INDEX IF NOT EXISTS idx_leads_client_id ON leads (client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status    ON leads (client_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_score     ON leads (client_id, bos_lead_score DESC);

-- 005 — identity resolution. Partial unique indexes so a contact known only by
-- phone and one known only by email can both exist, but the same email or phone
-- can never produce two rows for one client.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_client_email_uniq
  ON contacts (client_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_client_phone_uniq
  ON contacts (client_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_client_score
  ON contacts (client_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_contact
  ON contact_interactions (contact_id, created_at DESC);

-- 006
CREATE INDEX IF NOT EXISTS idx_rag_chunks_client_type
  ON rag_chunks (client_id, chunk_type) WHERE is_active = true;

-- 007 — one brand profile per client. brand_scout branches on existence to pick
-- update-vs-insert; this stops a concurrent double-run creating two rows.
CREATE UNIQUE INDEX IF NOT EXISTS brand_profiles_client_uniq
  ON brand_profiles (client_id);

-- 009
CREATE INDEX IF NOT EXISTS idx_invoices_client_overdue
  ON invoices (client_id, days_overdue DESC);

-- 010 — required by the ON CONFLICT in upsert_widget_session below.
CREATE UNIQUE INDEX IF NOT EXISTS widget_sessions_client_token_uniq
  ON widget_sessions (client_id, session_token);
CREATE INDEX IF NOT EXISTS idx_widget_sessions_client_updated
  ON widget_sessions (client_id, updated_at DESC);

-- 011
CREATE INDEX IF NOT EXISTS idx_content_calendar_client_date
  ON content_calendar (client_id, post_date);
CREATE INDEX IF NOT EXISTS idx_content_calendar_client_platform_date
  ON content_calendar (client_id, platform, post_date);

-- 012 — the reminder cron scans every client for tomorrow's unreminded
-- confirmations, so this one is deliberately not client-scoped.
CREATE INDEX IF NOT EXISTS idx_appointments_client_date
  ON appointments (client_id, requested_date);
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_due
  ON appointments (requested_date, status) WHERE reminder_sent = false;

-- 015
CREATE INDEX IF NOT EXISTS idx_weekly_briefs_client_week
  ON weekly_briefs (client_id, week_start, created_at DESC);

-- 016 — required by the prospect upsert's ON CONFLICT (client_id, place_id).
-- Partial, because place_id is NULL for every Apollo/CSV lead.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_client_place
  ON leads (client_id, place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_outreach_status
  ON leads (client_id, outreach_status);

-- 017
CREATE INDEX IF NOT EXISTS idx_leads_icp_score
  ON leads (client_id, icp_match_score DESC NULLS LAST);

-- 018 — suppress() relies on this as its ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS suppression_unique
  ON suppression_list (client_id, channel, address);
CREATE INDEX IF NOT EXISTS idx_suppression_lookup
  ON suppression_list (client_id, channel, address);
-- Token reuse across sends is deliberate: one durable link per recipient means
-- an old email still unsubscribes correctly.
CREATE UNIQUE INDEX IF NOT EXISTS unsubscribe_tokens_target
  ON unsubscribe_tokens (client_id, channel, address);

-- 019
CREATE INDEX IF NOT EXISTS idx_overture_state_city
  ON overture_places (state, city);
CREATE INDEX IF NOT EXISTS idx_overture_confidence
  ON overture_places (state, confidence DESC);

-- Category matching is ILIKE '%hint%', which no btree can serve.
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_overture_category_trgm
    ON overture_places USING gin (category gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_overture_name_trgm
    ON overture_places USING gin (name gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm indexes on overture_places skipped: %', SQLERRM;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 5. FUNCTIONS  (001, 006, 010)
-- All CREATE OR REPLACE, so re-running simply redefines them.
-- ───────────────────────────────────────────────────────────────────────────

-- 001 — legacy retrieval. No chunk_type, no type filter. Still the fallback
-- path in src/lib/embeddings.ts for databases where 006 was never applied.
CREATE OR REPLACE FUNCTION match_rag_chunks(
  query_embedding VECTOR(1024),
  match_client_id UUID,
  match_count     INT DEFAULT 5
)
RETURNS TABLE (id UUID, content TEXT, similarity FLOAT)
LANGUAGE plpgsql
AS $fn$
BEGIN
  RETURN QUERY
  SELECT
    rag_chunks.id,
    rag_chunks.content,
    1 - (rag_chunks.embedding <=> query_embedding) AS similarity
  FROM rag_chunks
  WHERE rag_chunks.client_id = match_client_id
    AND rag_chunks.is_active = true
  ORDER BY rag_chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$fn$;

-- 006 — the one that returns chunk_type and honours a type filter.
--
-- NOTE THE `embedding IS NOT NULL` PREDICATE: a chunk inserted without an
-- embedding is permanently invisible to retrieval. That is why the onboarding
-- upload path now generates one at insert time rather than deferring it.
CREATE OR REPLACE FUNCTION search_rag_chunks(
  query_embedding   VECTOR(1024),
  match_client_id   UUID,
  match_count       INT  DEFAULT 5,
  filter_chunk_type TEXT DEFAULT NULL
)
RETURNS TABLE (content TEXT, chunk_type TEXT, similarity FLOAT)
LANGUAGE sql
STABLE
AS $fn$
  SELECT
    rag_chunks.content,
    rag_chunks.chunk_type,
    1 - (rag_chunks.embedding <=> query_embedding) AS similarity
  FROM rag_chunks
  WHERE rag_chunks.client_id = match_client_id
    AND rag_chunks.is_active = true
    AND rag_chunks.embedding IS NOT NULL
    AND (filter_chunk_type IS NULL OR rag_chunks.chunk_type = filter_chunk_type)
  ORDER BY rag_chunks.embedding <=> query_embedding
  LIMIT match_count;
$fn$;

-- 001 — token accounting for the widget.
CREATE OR REPLACE FUNCTION increment_api_usage(
  p_client_id UUID,
  p_tokens    INT
)
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
BEGIN
  INSERT INTO api_usage (client_id, tokens_used, token_limit)
  VALUES (p_client_id, p_tokens, 100000)
  ON CONFLICT (client_id)
  DO UPDATE SET tokens_used = api_usage.tokens_used + p_tokens;
END;
$fn$;

-- 010 — read-modify-write from the route would lose increments when a visitor
-- sends two messages quickly. One statement keeps the count honest.
CREATE OR REPLACE FUNCTION upsert_widget_session(
  p_client_id      UUID,
  p_session_token  TEXT,
  p_classification TEXT
)
RETURNS widget_sessions
LANGUAGE plpgsql
AS $fn$
DECLARE
  result widget_sessions;
BEGIN
  INSERT INTO widget_sessions (client_id, session_token, visitor_classification, message_count)
  VALUES (p_client_id, p_session_token, p_classification, 1)
  ON CONFLICT (client_id, session_token) DO UPDATE
    SET message_count          = widget_sessions.message_count + 1,
        -- A visitor who turns into a prospect should not be downgraded to
        -- 'browser' by a later throwaway message.
        visitor_classification = CASE
          WHEN widget_sessions.visitor_classification = 'qualified_prospect'
            THEN widget_sessions.visitor_classification
          ELSE EXCLUDED.visitor_classification
        END,
        updated_at             = now()
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;


-- ───────────────────────────────────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY  (001, 004, 005, 021)
--
-- Every server route reaches these tables through supabaseAdmin (service role),
-- which BYPASSES RLS. These policies protect future anon/authenticated client
-- access; they are not what guards the API surface. That is
-- src/lib/auth-guard.ts.
--
-- overture_places is deliberately excluded: shared public reference data, not
-- tenant data, carrying nothing client-identifying.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'brand_profiles', 'rag_chunks', 'campaigns', 'leads',
    'agent_runs', 'api_usage', 'content_calendar', 'bookings',
    'call_transcripts', 'invoices', 'reviews', 'weekly_briefs',
    'approvals_queue', 'contacts', 'contact_interactions', 'widget_sessions',
    'appointments', 'suppression_list', 'unsubscribe_tokens'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    ELSE
      RAISE NOTICE 'RLS skipped, table missing: %', t;
    END IF;
  END LOOP;
END $$;

-- clients: each user sees only their own row.
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    DROP POLICY IF EXISTS "users_own_clients" ON clients;
    CREATE POLICY "users_own_clients" ON clients
      FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

-- Everything else: visible only if client_id belongs to the calling user.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brand_profiles', 'rag_chunks', 'campaigns', 'leads', 'agent_runs',
    'api_usage', 'content_calendar', 'bookings', 'call_transcripts',
    'invoices', 'reviews', 'weekly_briefs', 'approvals_queue', 'contacts',
    'contact_interactions', 'widget_sessions', 'appointments',
    'suppression_list', 'unsubscribe_tokens'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "client_isolation" ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY "client_isolation" ON public.%I FOR ALL USING '
        '(client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()))', t);
    END IF;
  END LOOP;
END $$;

-- 001 — service-role bypass policies for the public widget endpoints.
DO $$
BEGIN
  DROP POLICY IF EXISTS "service_role_read"   ON brand_profiles;
  CREATE POLICY "service_role_read"   ON brand_profiles
    FOR SELECT USING (auth.role() = 'service_role');

  DROP POLICY IF EXISTS "service_role_read"   ON clients;
  CREATE POLICY "service_role_read"   ON clients
    FOR SELECT USING (auth.role() = 'service_role');

  DROP POLICY IF EXISTS "service_role_read"   ON api_usage;
  CREATE POLICY "service_role_read"   ON api_usage
    FOR SELECT USING (auth.role() = 'service_role');

  DROP POLICY IF EXISTS "service_role_insert" ON api_usage;
  CREATE POLICY "service_role_insert" ON api_usage
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

  DROP POLICY IF EXISTS "service_role_update" ON api_usage;
  CREATE POLICY "service_role_update" ON api_usage
    FOR UPDATE USING (auth.role() = 'service_role');

  DROP POLICY IF EXISTS "service_role_insert" ON agent_runs;
  CREATE POLICY "service_role_insert" ON agent_runs
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

  DROP POLICY IF EXISTS "service_role_read"   ON rag_chunks;
  CREATE POLICY "service_role_read"   ON rag_chunks
    FOR SELECT USING (auth.role() = 'service_role');
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 7. STORAGE BUCKET  (008, extended for document uploads)
--
-- The onboarding uploader writes every file into 'brand-assets'. When the
-- bucket is absent, supabase-js returns "Bucket not found" and the route's own
-- guard turns that into a 503 naming the bucket.
--
-- Private on purpose: the route hands back time-limited signed URLs rather than
-- permanent public links.
--
-- allowed_mime_types now also covers the document types the uploader accepts.
-- A type missing from this list is rejected by storage itself, before any of
-- the route's own validation runs.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  FALSE,
  10485760,  -- 10MB. Vercel caps a request body at 4.5MB regardless, so the
             -- browser enforces a lower limit before upload — see the uploader.
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/svg+xml',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — run this after the script. Expect three t's.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'clients'
             AND column_name = 'contact_name')  AS clients_contact_name,
  EXISTS (SELECT 1 FROM storage.buckets
           WHERE id = 'brand-assets')           AS brand_assets_bucket,
  EXISTS (SELECT 1 FROM pg_proc
           WHERE proname = 'search_rag_chunks') AS search_rag_chunks_fn;
