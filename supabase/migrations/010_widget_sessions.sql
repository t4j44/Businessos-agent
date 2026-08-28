-- Receptionist widget: per-visitor session tracking + the brand fields the
-- widget renders.

CREATE TABLE IF NOT EXISTS widget_sessions (
  id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id              UUID        REFERENCES clients(id) ON DELETE CASCADE,
  session_token          TEXT        NOT NULL,
  visitor_classification TEXT,
  message_count          INT         DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

-- One row per visitor session. Required for the ON CONFLICT in the upsert
-- function below, which is what makes message_count safe under concurrent
-- messages from the same visitor.
CREATE UNIQUE INDEX IF NOT EXISTS widget_sessions_client_token_uniq
  ON widget_sessions (client_id, session_token);

CREATE INDEX IF NOT EXISTS idx_widget_sessions_client_updated
  ON widget_sessions (client_id, updated_at DESC);

-- Read-modify-write from the route would lose increments when a visitor sends
-- two messages quickly. Doing it in one statement keeps the count honest.
CREATE OR REPLACE FUNCTION upsert_widget_session(
  p_client_id      UUID,
  p_session_token  TEXT,
  p_classification TEXT
) RETURNS widget_sessions
LANGUAGE plpgsql
AS $$
DECLARE
  result widget_sessions;
BEGIN
  INSERT INTO widget_sessions (client_id, session_token, visitor_classification, message_count)
  VALUES (p_client_id, p_session_token, p_classification, 1)
  ON CONFLICT (client_id, session_token) DO UPDATE
    SET message_count          = widget_sessions.message_count + 1,
        -- A visitor who turns into a prospect should not be downgraded to
        -- 'browser' by a later throwaway message.
        visitor_classification = CASE
          WHEN widget_sessions.visitor_classification = 'qualified_prospect'
            THEN widget_sessions.visitor_classification
          ELSE EXCLUDED.visitor_classification
        END,
        updated_at             = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

-- The widget header renders the client's logo; brand_profiles had no column for
-- it. Phone for the booking card comes from contact_info (added in 007) or
-- clients.contact_phone (added in 002), so neither needs a new column.
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS logo_url TEXT;
