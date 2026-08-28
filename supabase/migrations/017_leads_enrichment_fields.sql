-- Hunter Enrich writes what it discovered about a lead back onto the row:
-- the contact email and how much to trust it, plus the ICP match the model
-- scored. Migration 016 added the Places fields; these are the enrichment
-- results that follow.

ALTER TABLE leads
  -- Contact discovery. email_source is 'website' (scraped from the page),
  -- 'pattern' (guessed from the domain, unverified), or NULL when no address
  -- survived MX verification.
  ADD COLUMN IF NOT EXISTS email_found      TEXT,
  ADD COLUMN IF NOT EXISTS email_confidence INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_source     TEXT,

  -- ICP match, scored against the client's brand_profiles.icp_summary.
  ADD COLUMN IF NOT EXISTS icp_match_score  INT,
  ADD COLUMN IF NOT EXISTS icp_match_reason TEXT,
  ADD COLUMN IF NOT EXISTS pain_points      JSONB DEFAULT '[]',

  -- `leads` only carried created_at; the enrich step needs to record when a
  -- row was last worked.
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT now();

-- The dashboard ranks enriched leads by match quality.
CREATE INDEX IF NOT EXISTS idx_leads_icp_score
  ON leads (client_id, icp_match_score DESC NULLS LAST);
