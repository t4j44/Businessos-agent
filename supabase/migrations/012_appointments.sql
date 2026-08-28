-- Lightweight appointment requests for the scheduler agent.
--
-- Deliberately separate from `bookings` (001/004): that table is built around
-- nylas_event_id and a calendar sync this agent does not use. Nothing here
-- touches it.
--
-- requested_time is TEXT, not TIME, on purpose. Website booking forms submit
-- things like "2:30pm", "afternoon" or "after 5" — coercing that to TIME would
-- reject real requests. The reminder cron filters on requested_date, which IS
-- typed, so nothing depends on parsing the time.

CREATE TABLE IF NOT EXISTS appointments (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID        REFERENCES clients(id) ON DELETE CASCADE,
  customer_name  TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  requested_date DATE,
  requested_time TEXT,
  service_type   TEXT,
  status         TEXT        DEFAULT 'pending',
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),

  -- Beyond the requested column list, but the confirm and reminder steps do
  -- not work without them:
  --   confirmed_date/confirmed_time — the confirm endpoint takes a time that
  --     may differ from what was requested; overwriting requested_time would
  --     destroy the record of what the customer originally asked for.
  --   reminder_sent — without it the daily cron re-sends the same reminder on
  --     every run. `bookings` carries the same flag for the same reason.
  --   updated_at — so a confirmation is distinguishable from a stale row.
  confirmed_date DATE,
  confirmed_time TEXT,
  reminder_sent  BOOL        DEFAULT false,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Columns added separately so the migration is safe on a database where an
-- earlier version of this table already exists.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_date DATE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_time TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent  BOOL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_status_check'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_status_check
      CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed'));
  END IF;
END $$;

-- The GET route orders by requested_date within a client.
CREATE INDEX IF NOT EXISTS idx_appointments_client_date
  ON appointments (client_id, requested_date);

-- The reminder cron scans every client for tomorrow's unreminded confirmations,
-- so this one is deliberately not client-scoped.
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_due
  ON appointments (requested_date, status)
  WHERE reminder_sent = false;
