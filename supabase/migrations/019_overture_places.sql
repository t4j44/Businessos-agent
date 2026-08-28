-- Overture Maps Places — the lead-discovery source that replaces Google Places.
--
-- WHY: Google's Places API terms permit storing only place_id indefinitely;
-- everything else falls under caching restrictions. Business OS stores lead
-- data permanently and embeds it into RAG, which those terms do not allow.
-- Overture Places is CDLA Permissive 2.0 — storage, modification and commercial
-- use are all permitted with attribution.
--
-- NOTE: this file was not present in the repository when the Overture code was
-- written, and no earlier migration created this table. Every statement is
-- guarded, so re-running is a no-op if equivalent SQL was already applied.
--
-- Rows are loaded in bulk by scripts/overture-etl.sh via CSV import, not by the
-- application. Nothing in the app writes to this table.

CREATE TABLE IF NOT EXISTS overture_places (
  overture_id TEXT PRIMARY KEY,
  name        TEXT,
  category    TEXT,
  website     TEXT,
  phone       TEXT,
  -- Overture carries an email for a share of records; Google did not.
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

-- The prospect query filters on state + city + category and orders by
-- confidence, so that is the index it needs.
CREATE INDEX IF NOT EXISTS idx_overture_state_city
  ON overture_places (state, city);

CREATE INDEX IF NOT EXISTS idx_overture_confidence
  ON overture_places (state, confidence DESC);

-- Category matching is ILIKE '%hint%', which cannot use a btree index.
-- pg_trgm makes that prefix-free match indexable.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_overture_category_trgm
  ON overture_places USING gin (category gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_overture_name_trgm
  ON overture_places USING gin (name gin_trgm_ops);

-- This is reference data shared across all clients, not tenant data, so RLS is
-- deliberately NOT enabled: every client prospects from the same public
-- directory. Nothing client-identifying is stored here.

-- The ICP scoring prompt reads the lead's city and state. `leads` had city
-- (migration 016) but no state; Overture supplies both.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS state TEXT;
