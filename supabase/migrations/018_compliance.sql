-- CAN-SPAM / TCPA / FDCPA compliance surface.
--
-- NOTE: this file was not present in the repository when the compliance code
-- was written, and no earlier migration created these objects. If equivalent
-- SQL was already applied directly in the Supabase console, every statement
-- here is guarded with IF NOT EXISTS and re-running is a no-op.

-- Addresses that must never be contacted again, per client and per channel.
CREATE TABLE IF NOT EXISTS suppression_list (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID        REFERENCES clients(id) ON DELETE CASCADE,
  channel    TEXT        NOT NULL CHECK (channel IN ('email', 'sms')),
  -- Lower-cased email address or E.164 phone number.
  address    TEXT        NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One row per (client, channel, address): suppress() is idempotent and relies
-- on this for its ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS suppression_unique
  ON suppression_list (client_id, channel, address);

-- Stable per-recipient unsubscribe tokens. The token is the only thing in the
-- unsubscribe URL, so it must be unguessable — 32 random bytes, base64url.
CREATE TABLE IF NOT EXISTS unsubscribe_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  token      TEXT        NOT NULL UNIQUE,
  client_id  UUID        REFERENCES clients(id) ON DELETE CASCADE,
  channel    TEXT        NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
  address    TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  used_at    TIMESTAMPTZ
);

-- Token reuse across sends is deliberate: one durable link per recipient means
-- an old email still unsubscribes correctly.
CREATE UNIQUE INDEX IF NOT EXISTS unsubscribe_tokens_target
  ON unsubscribe_tokens (client_id, channel, address);

-- ── Consent ────────────────────────────────────────────────────────────────
-- leads.phone_consent already exists (migration 001) but nothing recorded WHEN
-- or WHERE consent came from, which is what TCPA actually requires you to show.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email_consent          BOOL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_consent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_consent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_consent_source   TEXT;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_consent          BOOL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_consent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_consent          BOOL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_consent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_consent_source   TEXT;

CREATE INDEX IF NOT EXISTS idx_suppression_lookup
  ON suppression_list (client_id, channel, address);
