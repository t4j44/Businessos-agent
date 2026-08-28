-- Hunter Prospect discovers local businesses through Google Places and stores
-- them as lead candidates.
--
-- The existing `leads` table was shaped for Apollo imports (email, company,
-- linkedin_url, apollo_id). A Places result carries a different set of facts —
-- a place id, a website, a street address, a rating — so those columns are
-- added here. Nothing existing is altered or dropped.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS place_id        TEXT,
  ADD COLUMN IF NOT EXISTS website         TEXT,
  ADD COLUMN IF NOT EXISTS address         TEXT,
  ADD COLUMN IF NOT EXISTS city            TEXT,
  ADD COLUMN IF NOT EXISTS category        TEXT,
  ADD COLUMN IF NOT EXISTS rating          NUMERIC,
  ADD COLUMN IF NOT EXISTS review_count    INT,
  ADD COLUMN IF NOT EXISTS prospect_query  TEXT,
  ADD COLUMN IF NOT EXISTS outreach_status TEXT DEFAULT 'new';

-- Required by the upsert's ON CONFLICT (client_id, place_id): without a unique
-- index Postgres rejects the statement with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification".
--
-- Partial, because place_id is NULL for every lead that arrived from Apollo or
-- a CSV import. A plain unique index would treat those as distinct anyway, but
-- the WHERE clause keeps the index small and makes the intent explicit: this
-- uniqueness rule is about Places-sourced rows only.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_client_place
  ON leads (client_id, place_id)
  WHERE place_id IS NOT NULL;

-- Prospecting reads back by campaign query and by status.
CREATE INDEX IF NOT EXISTS idx_leads_outreach_status
  ON leads (client_id, outreach_status);
