-- Brand DNA fields that had no column.
--
-- brand_scout now extracts tagline, description, contact_info and location.
-- The other Brand DNA concepts already have homes under the project's existing
-- names, so only these four are new:
--
--   business_name            -> company_name        (exists)
--   products_services        -> products_json       (exists)
--   target_customer          -> icp_summary         (exists)
--   tone_of_voice            -> tone_description    (exists)
--   competitors              -> competitors_json    (exists)
--   unique_value_proposition -> value_proposition   (exists)

ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS tagline      TEXT,
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS contact_info JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS location     TEXT;

-- One brand profile per client. brand_scout branches on existence to decide
-- update-vs-insert, and this stops a concurrent double-run creating two rows.
-- Dropped first so re-running the migration is safe.
CREATE UNIQUE INDEX IF NOT EXISTS brand_profiles_client_uniq
  ON brand_profiles (client_id);
