-- Nightwatch stores its nightly synthesis on the week's brief row, so the
-- BI Reporter can fold it into Monday's brief.
--
-- NOTE ON THE MISSING UNIQUE CONSTRAINT: it would be natural to add
-- UNIQUE (client_id, week_start) here so Nightwatch could upsert. Deliberately
-- not done — /api/agents/bi-reporter does a plain INSERT into weekly_briefs
-- and can legitimately write more than one brief for the same week (a manual
-- "Generate Brief" click after the cron has already run). Adding the
-- constraint would start failing those inserts.
--
-- Nightwatch therefore reads the latest row for the week and updates it, or
-- inserts one if none exists. See storeIntelligence() in
-- src/app/api/agents/nightwatch/route.ts.

ALTER TABLE weekly_briefs
  ADD COLUMN IF NOT EXISTS intelligence_report_json JSONB;

-- Nightwatch and the BI Reporter both look a brief up by (client_id,
-- week_start) and take the newest. Non-unique, purely to make that lookup
-- cheap.
CREATE INDEX IF NOT EXISTS idx_weekly_briefs_client_week
  ON weekly_briefs (client_id, week_start, created_at DESC);
