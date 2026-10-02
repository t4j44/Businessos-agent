-- CSV lead import: deduplicate instead of inserting blindly.
--
-- THE BUG. /api/agents/enrichment/csv-import did a plain INSERT, so importing
-- the same file twice duplicated every lead. hunter/prospect already upserts on
-- (client_id, place_id), but place_id is NULL for CSV rows so that index does
-- not apply to them.
--
-- ADDITIVE ONLY. No row is deleted or rewritten, and no existing column
-- changes type or nullability. The duplicates already in the table are left
-- exactly where they are — this stops new ones, it does not clean up history.
--
-- WHY THE UNIQUE INDEX CAN BE ADDED SAFELY. It is on (client_id, dedupe_key),
-- and dedupe_key is NULL on every row that already exists. PostgreSQL treats
-- NULLs as distinct in a unique index, so no historical row can collide with
-- another, and the index builds on a database already full of duplicate emails.
-- Only rows written by the new import path carry a key, so only they are
-- constrained.

ALTER TABLE leads
  -- When this lead arrived. created_at already exists, but an import can
  -- backfill older leads, so "when we received the file" is its own fact.
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ,
  -- Normalised company domain: lowercase host, no scheme, no www., no port or
  -- path. Used to match a lead that has no email address.
  ADD COLUMN IF NOT EXISTS domain      TEXT,
  -- What makes this lead unique within an import: the normalised email, else
  -- 'domain:<domain>'. NULL when the row has neither, which is why those rows
  -- cannot be deduplicated and are always imported.
  ADD COLUMN IF NOT EXISTS dedupe_key  TEXT;

-- One definition of domain normalisation, shared by the backfill below and
-- mirrored by normalizeDomain() in the import route. IMMUTABLE so it can be
-- used in an index expression if that is ever wanted.
CREATE OR REPLACE FUNCTION normalize_lead_domain(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT nullif(
    regexp_replace(
      -- Host only, in this order: drop the scheme, then everything from the
      -- first /, ? or #, then any :port, then a leading www. normalizeDomain()
      -- in the import route mirrors these steps exactly, and a test asserts the
      -- two agree.
      regexp_replace(
        split_part(
          split_part(
            split_part(
              split_part(
                regexp_replace(lower(trim(coalesce(p_value,''))), '^[a-z][a-z0-9+.-]*://', ''),
              '/', 1),
            '?', 1),
          '#', 1),
        ':', 1),
        '^www\.', ''
      ),
      '[:.]+$', ''
    ), '')
$$;

-- Give existing leads a domain so a new import can be matched against the
-- history as well as against itself. Writes only the new column.
UPDATE leads
   SET domain = normalize_lead_domain(website)
 WHERE domain IS NULL AND website IS NOT NULL AND trim(website) <> '';

-- Lookup support for the duplicate checks. Both non-unique: a client may well
-- already have several leads sharing an email or a domain, and that history is
-- not being rewritten.
CREATE INDEX IF NOT EXISTS idx_leads_client_email_lower
  ON leads (client_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_client_domain
  ON leads (client_id, domain) WHERE domain IS NOT NULL;

-- The guarantee for imported rows. See the note above on why NULL keys make
-- this safe to add to an existing table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_client_dedupe_key
  ON leads (client_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ── Import ──────────────────────────────────────────────────────────────────
-- Inserts the rows that are not already present, in one statement, and reports
-- how many were taken. Doing it here rather than in the route means the
-- duplicate check and the insert cannot be separated by another request: two
-- simultaneous uploads of the same file both call this, and the second finds
-- the first's rows (or loses the ON CONFLICT race) rather than duplicating them.
--
-- p_rows: a JSON array of
--   { name, email, company, website, domain, dedupe_key, linkedin_url, phone,
--     phone_consent, phone_consent_source }
-- Returns { imported, skipped_duplicate }.
CREATE OR REPLACE FUNCTION import_csv_leads(p_client_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE candidate_count integer; inserted_count integer;
BEGIN
  IF p_client_id IS NULL OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('imported',0,'skipped_duplicate',0);
  END IF;

  WITH numbered AS (
    -- row_number() rather than WITH ORDINALITY, which PostgreSQL will not
    -- accept alongside a column definition list.
    SELECT r.*, row_number() OVER () AS ord
    FROM jsonb_to_recordset(p_rows) AS r(
      name text, email text, company text, website text, domain text,
      dedupe_key text, linkedin_url text, phone text,
      phone_consent boolean, phone_consent_source text
    )
  ), candidates AS (
    -- DISTINCT ON keeps the first occurrence of each key. The route already
    -- removes within-file duplicates; this keeps the function correct alone.
    -- Rows with no key fall back to their position, so they are never
    -- collapsed into each other.
    SELECT DISTINCT ON (coalesce(dedupe_key, 'row#' || ord::text))
      name, email, company, website, domain, dedupe_key,
      linkedin_url, phone, coalesce(phone_consent,false) AS phone_consent,
      phone_consent_source
    FROM numbered
    ORDER BY coalesce(dedupe_key, 'row#' || ord::text), ord
  ), fresh AS (
    INSERT INTO leads (
      client_id, name, email, company, website, domain, dedupe_key,
      linkedin_url, phone, phone_consent, phone_consent_at, phone_consent_source,
      source, status, outreach_status, imported_at
    )
    SELECT
      p_client_id, c.name, c.email, c.company, c.website, c.domain, c.dedupe_key,
      c.linkedin_url, c.phone, c.phone_consent,
      CASE WHEN c.phone_consent THEN now() ELSE NULL END, c.phone_consent_source,
      'csv', 'pending', 'new', now()
    FROM candidates c
    -- Already have this lead? Same email, or same company domain when the
    -- incoming row has no email. Covers leads from every other source too,
    -- not just previous CSV imports.
    WHERE NOT EXISTS (
      SELECT 1 FROM leads l
       WHERE l.client_id = p_client_id
         AND (
           (c.email IS NOT NULL AND lower(l.email) = c.email)
           OR (c.email IS NULL AND c.domain IS NOT NULL AND l.domain = c.domain)
         )
    )
    -- Loses to a concurrent import of the same file rather than duplicating.
    ON CONFLICT (client_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM fresh)
    INTO candidate_count, inserted_count;

  RETURN jsonb_build_object(
    'imported', inserted_count,
    'skipped_duplicate', candidate_count - inserted_count
  );
END $$;

REVOKE ALL ON FUNCTION normalize_lead_domain(text), import_csv_leads(uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION normalize_lead_domain(text), import_csv_leads(uuid,jsonb)
  TO service_role;
