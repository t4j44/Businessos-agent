-- Content calendar for the Creative Agent.
--
-- NOTE: content_calendar is NOT a new table — 001_initial_schema.sql declares
-- it and 004_catchup_missing_tables.sql recreates it. This migration only adds
-- what the 30-day calendar needs on top, and repeats the CREATE for databases
-- where 001/004 have not been applied. Idempotent throughout.
--
-- On the requested column names:
--   post_date  -> added below. The table only had scheduled_at (TIMESTAMPTZ);
--                 a DATE column is the right key for one-post-per-day.
--   post_copy  -> deliberately NOT added. The post body already lives in
--                 `content`, which src/app/api/dashboard/content/route.ts
--                 reads. A second copy column would be a second source of
--                 truth for the same text and would drift.

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

-- The calendar day this post belongs to, independent of the send time.
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS post_date DATE;

-- Backfill so existing rows sort correctly alongside newly generated ones.
UPDATE content_calendar
   SET post_date = scheduled_at::date
 WHERE post_date IS NULL
   AND scheduled_at IS NOT NULL;

-- status is draft | approved | published. Enforced here so a bad write fails
-- loudly instead of quietly producing a calendar the dashboard cannot filter.
-- Existing values outside the set are normalised to 'draft' first.
UPDATE content_calendar
   SET status = 'draft'
 WHERE status IS NULL
    OR status NOT IN ('draft', 'approved', 'published', 'scheduled', 'rejected');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_calendar_status_check'
  ) THEN
    ALTER TABLE content_calendar
      ADD CONSTRAINT content_calendar_status_check
      CHECK (status IN ('draft', 'approved', 'published', 'scheduled', 'rejected'));
  END IF;
END $$;

-- The generator clears prior drafts by (client, platform, date window) and the
-- GET handler orders by post_date.
CREATE INDEX IF NOT EXISTS idx_content_calendar_client_date
  ON content_calendar (client_id, post_date);

CREATE INDEX IF NOT EXISTS idx_content_calendar_client_platform_date
  ON content_calendar (client_id, platform, post_date);
