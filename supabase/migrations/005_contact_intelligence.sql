-- Contact Intelligence layer.
--
-- One unified person-record per client, plus an append-only interaction log
-- every agent writes to. Nothing in src/lib/contacts.ts works until this runs.
--
-- Column names track the contacts.ts contract exactly: contacts uses
-- score/status/source, contact_interactions uses agent_name/metadata.

CREATE TABLE IF NOT EXISTS contacts (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- Identity resolution. Partial unique indexes so a contact known only by phone
-- and one known only by email can both exist, but the same email or phone can
-- never produce two rows for one client.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_client_email_uniq
  ON contacts (client_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_client_phone_uniq
  ON contacts (client_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_client_score
  ON contacts (client_id, score DESC);

CREATE TABLE IF NOT EXISTS contact_interactions (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id       UUID        REFERENCES contacts(id) ON DELETE CASCADE,
  client_id        UUID        REFERENCES clients(id) ON DELETE CASCADE,
  agent_name       TEXT        NOT NULL,
  interaction_type TEXT        NOT NULL,
  summary          TEXT,
  sentiment_score  INT,
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interactions_contact
  ON contact_interactions (contact_id, created_at DESC);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_isolation" ON contacts;
CREATE POLICY "client_isolation" ON contacts
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "client_isolation" ON contact_interactions;
CREATE POLICY "client_isolation" ON contact_interactions
  FOR ALL USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));
