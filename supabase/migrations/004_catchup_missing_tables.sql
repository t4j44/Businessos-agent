-- Catch-up migration.
--
-- The live database is missing four tables that 001_initial_schema.sql declares:
-- campaigns, leads, content_calendar and bookings. 001 uses bare CREATE TABLE,
-- so it cannot be re-run against a database where the other tables already
-- exist. This migration is idempotent and brings those four into line without
-- touching anything that already applied.
--
-- Definitions here are copied verbatim from 001 — keep them in sync.

CREATE TABLE IF NOT EXISTS campaigns (
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

CREATE TABLE IF NOT EXISTS leads (
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

CREATE TABLE IF NOT EXISTS content_calendar (
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

CREATE TABLE IF NOT EXISTS bookings (
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

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE campaigns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_isolation" ON campaigns;
CREATE POLICY "client_isolation" ON campaigns
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "client_isolation" ON leads;
CREATE POLICY "client_isolation" ON leads
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "client_isolation" ON content_calendar;
CREATE POLICY "client_isolation" ON content_calendar
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "client_isolation" ON bookings;
CREATE POLICY "client_isolation" ON bookings
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_client_id       ON leads(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status          ON leads(client_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_score           ON leads(client_id, bos_lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_client_type ON campaigns(client_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_content_client        ON content_calendar(client_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_client       ON bookings(client_id, scheduled_at DESC);
