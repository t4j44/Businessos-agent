-- ═══════════════════════════════════════════════════════════════════════════
-- CATCH-UP: tables that exist in the migration files but not in the live
-- database.
--
-- A live audit found that migrations 001, 004, 010 and 012 were only partially
-- applied. Four tables were never created:
--
--   appointments      (012) — the Scheduler agent writes every booking request
--   widget_sessions   (010) — the Receptionist widget's per-visitor tracking,
--                             plus the upsert_widget_session() function
--   campaigns         (001/004) — Hunter's ICP config, and agent_runs.campaign_id
--                                 references it
--   bookings          (001/004) — demo/booking records read by call-center
--
-- This file re-creates exactly those four, with their indexes, RLS and
-- policies, and nothing else. It touches no table that already exists.
--
-- SAFE TO RE-RUN. Every CREATE TABLE and CREATE INDEX is IF NOT EXISTS, every
-- policy is preceded by DROP POLICY IF EXISTS, and the function is CREATE OR
-- REPLACE.
--
-- WHERE 001 AND 004 DISAGREE: they do not. 004 restates campaigns and bookings
-- with identical columns, types and defaults, differing only in using
-- IF NOT EXISTS and DROP POLICY IF EXISTS. The 004 form is used here.
--
-- gen_random_uuid() is used instead of uuid_generate_v4(): the uuid-ossp
-- extension may not be enabled on this database, whereas pgcrypto's
-- gen_random_uuid() is built into PostgreSQL 13+. Column types and defaults are
-- otherwise preserved exactly as the source migrations define them.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── campaigns (001 / 004) ──────────────────────────────────────────────────
-- agent_runs.campaign_id carries a foreign key to this table, so its absence
-- also breaks that reference.
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

CREATE INDEX IF NOT EXISTS idx_campaigns_client_type
  ON campaigns (client_id, agent_type);


-- ── bookings (001 / 004) ───────────────────────────────────────────────────
-- Distinct from `appointments`: this is the Nylas-backed calendar record.
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

CREATE INDEX IF NOT EXISTS idx_bookings_client
  ON bookings (client_id, scheduled_at DESC);


-- ── widget_sessions (010) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS widget_sessions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              UUID        REFERENCES clients(id) ON DELETE CASCADE,
  session_token          TEXT        NOT NULL,
  visitor_classification TEXT,
  message_count          INT         DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

-- One row per visitor session. Required for the ON CONFLICT in the upsert
-- function below, which is what makes message_count safe under concurrent
-- messages from the same visitor.
CREATE UNIQUE INDEX IF NOT EXISTS widget_sessions_client_token_uniq
  ON widget_sessions (client_id, session_token);

CREATE INDEX IF NOT EXISTS idx_widget_sessions_client_updated
  ON widget_sessions (client_id, updated_at DESC);


-- ── appointments (012) ─────────────────────────────────────────────────────
-- requested_time is TEXT, not TIME, on purpose. Website booking forms submit
-- things like "2:30pm", "afternoon" or "after 5"; coercing that to TIME would
-- reject real requests. The reminder cron filters on requested_date, which IS
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

  -- confirmed_date/confirmed_time — the confirm endpoint takes a time that may
  --   differ from what was requested; overwriting requested_time would destroy
  --   the record of what the customer originally asked for.
  -- reminder_sent — without it the daily cron re-sends the same reminder on
  --   every run.
  -- updated_at — so a confirmation is distinguishable from a stale row.
  confirmed_date DATE,
  confirmed_time TEXT,
  reminder_sent  BOOL        DEFAULT false,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Restated separately so this is also safe on a database where an earlier
-- version of the table already exists without them.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_date DATE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_time TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent  BOOL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT now();

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

-- The GET route orders by requested_date within a client.
CREATE INDEX IF NOT EXISTS idx_appointments_client_date
  ON appointments (client_id, requested_date);

-- The reminder cron scans every client for tomorrow's unreminded confirmations,
-- so this one is deliberately not client-scoped.
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_due
  ON appointments (requested_date, status)
  WHERE reminder_sent = false;


-- ── upsert_widget_session (010) ────────────────────────────────────────────
-- Read-modify-write from the route would lose increments when a visitor sends
-- two messages quickly. Doing it in one statement keeps the count honest.
CREATE OR REPLACE FUNCTION upsert_widget_session(
  p_client_id      UUID,
  p_session_token  TEXT,
  p_classification TEXT
) RETURNS widget_sessions
LANGUAGE plpgsql
AS $$
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
$$;


-- ── Row Level Security ─────────────────────────────────────────────────────
-- campaigns and bookings carry client_isolation in 001/004. appointments and
-- widget_sessions never had RLS defined in any migration — added here so all
-- four are consistent.
--
-- Note: every server route reaches these tables through supabaseAdmin (service
-- role), which bypasses RLS. These policies protect any future anon/authed
-- client access, not the API surface — that is guarded by src/lib/auth-guard.ts.
ALTER TABLE campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_isolation" ON campaigns;
CREATE POLICY "client_isolation" ON campaigns
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "client_isolation" ON bookings;
CREATE POLICY "client_isolation" ON bookings
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "client_isolation" ON appointments;
CREATE POLICY "client_isolation" ON appointments
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "client_isolation" ON widget_sessions;
CREATE POLICY "client_isolation" ON widget_sessions
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));
