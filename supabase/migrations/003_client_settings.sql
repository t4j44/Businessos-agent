-- Settings page persistence.
--
-- The Settings screen previously kept profile and notification preferences in
-- component state only, so nothing survived a refresh. These columns give it a
-- real home on the client record.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS timezone      TEXT  DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS settings_json JSONB DEFAULT '{}';

COMMENT ON COLUMN clients.settings_json IS
  'Per-client preferences, currently { notifications: { <key>: boolean } }.';
