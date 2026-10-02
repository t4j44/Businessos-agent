-- One sent Monday Brief per client per week.
--
-- THE BUG. /api/agents/bi-reporter/generate emailed the brief and then stamped
-- weekly_briefs.sent_at, with nothing checked beforehand. A Vercel retry, a
-- second cron invocation, or two deploys both carrying the schedule each
-- generated a fresh brief row and emailed the customer again.
--
-- WHY NOT UNIQUE (client_id, week_start) ON weekly_briefs. That is the obvious
-- fix and it is wrong here. Migration 015 already recorded the reason:
-- /api/agents/bi-reporter does a plain INSERT, and more than one brief per week
-- is legitimate — the owner can click "Generate Brief" after the cron has run,
-- and Nightwatch inserts a stub row to hang its overnight synthesis on when no
-- brief exists yet. A unique index would start rejecting both. It would also
-- fail to build at all on any database where the duplicate-email bug has
-- already produced duplicate rows.
--
-- WHO TOUCHES weekly_briefs (mapped before choosing this design):
--   writes
--     bi-reporter/route.ts       INSERT, a new row per run (cron or manual)
--     bi-reporter/generate       UPDATE sent_at on that one row, by id
--     nightwatch/route.ts        UPDATE intelligence_report_json on the newest
--                                row for the week, or INSERT a stub if none
--   reads
--     bi-reporter/route.ts       newest row for the week -> intelligence_report_json
--     dashboard/metrics          newest row for the client -> brief_html, ware_score
--     brief/[id]/page.tsx        one row by id
--     MondayBrief.tsx            last 10 rows by week_start
-- Every one of those depends on "many rows per week, newest wins". This
-- migration leaves that untouched.
--
-- THE DESIGN. Delivery is a separate fact from the brief, so it gets its own
-- table with the unique constraint on it. A send is claimed before the provider
-- is contacted and only becomes 'sent' once a receipt comes back. The table is
-- new, so the constraint always builds cleanly however many duplicate brief
-- rows already exist. Nothing is deleted and no existing row is modified.

CREATE TABLE IF NOT EXISTS weekly_brief_sends (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start       DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'sending'
                     CHECK (status IN ('sending','sent','failed','review')),
  -- Which brief row was actually delivered. Nullable: the claim is taken before
  -- the brief is generated, so the AI call is not made for a week already sent.
  brief_id         UUID REFERENCES weekly_briefs(id) ON DELETE SET NULL,
  -- Resend's receipt. 'sent' is never set without one.
  provider_id      TEXT,
  -- Deterministic, so a retry of the same week reuses it and Resend collapses
  -- the duplicate inside its 24-hour window.
  idempotency_key  TEXT NOT NULL,
  attempts         INT NOT NULL DEFAULT 0,
  lease_until      TIMESTAMPTZ,
  first_attempt_at TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The guarantee.
  UNIQUE (client_id, week_start)
);

ALTER TABLE weekly_brief_sends ENABLE ROW LEVEL SECURITY;
-- Delivery bookkeeping is operational, not customer-facing, and the owner reads
-- sent_at from weekly_briefs as before. Only the guarded API touches this.
REVOKE ALL ON weekly_brief_sends FROM anon,authenticated;
GRANT ALL ON weekly_brief_sends TO service_role;

-- Weeks already emailed before this migration. Without this, the first run
-- after deploying would send a second copy for the current week. DISTINCT ON
-- collapses the duplicate rows the bug produced, keeping the earliest delivery;
-- ON CONFLICT keeps the statement re-runnable. Inserts only — no brief row is
-- read for anything but its delivery facts, and none is modified or removed.
INSERT INTO weekly_brief_sends (
  client_id, week_start, status, brief_id, provider_id,
  idempotency_key, attempts, first_attempt_at, sent_at, last_error
)
SELECT DISTINCT ON (client_id, week_start)
  client_id, week_start, 'sent', id, NULL,
  'brief/' || client_id || '/' || week_start, 1, sent_at, sent_at,
  'backfilled from weekly_briefs.sent_at; no provider receipt was recorded'
FROM weekly_briefs
WHERE sent_at IS NOT NULL AND client_id IS NOT NULL AND week_start IS NOT NULL
ORDER BY client_id, week_start, sent_at ASC
ON CONFLICT (client_id, week_start) DO NOTHING;

-- ── Claim ───────────────────────────────────────────────────────────────────
-- The atomic gate. Two simultaneous cron runs both call this; the unique
-- constraint means exactly one INSERT succeeds and the loser falls through to
-- the FOR UPDATE branch, where it sees a live lease and is refused.
--
-- Returns jsonb: { claimed, reason, idempotency_key, attempts, sent_at }.
CREATE OR REPLACE FUNCTION claim_weekly_brief_send(
  p_client_id uuid,
  p_week_start date,
  p_lease_seconds integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE row weekly_brief_sends; key text;
BEGIN
  IF p_client_id IS NULL OR p_week_start IS NULL THEN
    RETURN jsonb_build_object('claimed',false,'reason','invalid_request');
  END IF;
  key := 'brief/' || p_client_id || '/' || p_week_start;

  -- First writer for this (client, week) wins outright.
  INSERT INTO weekly_brief_sends (
    client_id, week_start, status, idempotency_key,
    attempts, lease_until, first_attempt_at
  ) VALUES (
    p_client_id, p_week_start, 'sending', key,
    1, now() + make_interval(secs => p_lease_seconds), now()
  )
  ON CONFLICT (client_id, week_start) DO NOTHING
  RETURNING * INTO row;

  IF FOUND THEN
    RETURN jsonb_build_object('claimed',true,'reason','claimed',
      'idempotency_key',row.idempotency_key,'attempts',row.attempts);
  END IF;

  SELECT * INTO row FROM weekly_brief_sends
   WHERE client_id=p_client_id AND week_start=p_week_start FOR UPDATE;

  IF row.status='sent' THEN
    RETURN jsonb_build_object('claimed',false,'reason','already_sent',
      'sent_at',row.sent_at,'idempotency_key',row.idempotency_key);
  END IF;

  IF row.status='review' THEN
    RETURN jsonb_build_object('claimed',false,'reason','needs_review',
      'idempotency_key',row.idempotency_key,'attempts',row.attempts);
  END IF;

  -- Another run holds it and is still working.
  IF row.status='sending' AND row.lease_until > now() THEN
    RETURN jsonb_build_object('claimed',false,'reason','in_progress',
      'idempotency_key',row.idempotency_key,'attempts',row.attempts);
  END IF;

  -- Past the point where a resend is provably safe. Resend forgets an
  -- idempotency key after 24 hours, so beyond that a retry could deliver a
  -- second copy; an operator decides instead of the cron guessing.
  IF row.attempts >= 5 OR row.first_attempt_at < now() - interval '23 hours' THEN
    UPDATE weekly_brief_sends
       SET status='review', last_error='retry_window_exhausted',
           lease_until=NULL, updated_at=now()
     WHERE id=row.id;
    RETURN jsonb_build_object('claimed',false,'reason','needs_review',
      'idempotency_key',row.idempotency_key,'attempts',row.attempts);
  END IF;

  -- Retryable: either a definite failure (nothing reached the provider), or a
  -- 'sending' row whose lease expired because the process died. The second case
  -- is ambiguous, which is exactly what the deterministic idempotency key is
  -- for — Resend returns the original receipt instead of sending again.
  UPDATE weekly_brief_sends
     SET status='sending', attempts=attempts+1, last_error=NULL,
         lease_until=now() + make_interval(secs => p_lease_seconds),
         first_attempt_at=coalesce(first_attempt_at, now()), updated_at=now()
   WHERE id=row.id
  RETURNING * INTO row;

  RETURN jsonb_build_object('claimed',true,'reason','reclaimed',
    'idempotency_key',row.idempotency_key,'attempts',row.attempts);
END $$;

-- ── Finish ──────────────────────────────────────────────────────────────────
-- Only a provider receipt turns a claim into 'sent'. Stamps weekly_briefs.sent_at
-- in the same transaction so the owner-facing row and the delivery record can
-- never disagree.
CREATE OR REPLACE FUNCTION finish_weekly_brief_send(
  p_client_id uuid,
  p_week_start date,
  p_brief_id uuid,
  p_provider_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE row weekly_brief_sends;
BEGIN
  IF p_provider_id IS NULL OR length(trim(p_provider_id))=0 THEN RETURN false; END IF;

  SELECT * INTO row FROM weekly_brief_sends
   WHERE client_id=p_client_id AND week_start=p_week_start FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Replaying the same receipt is a no-op success, so a crashed caller can
  -- finish twice without being told it failed.
  IF row.status='sent' THEN RETURN row.provider_id IS NOT DISTINCT FROM p_provider_id; END IF;
  IF row.status<>'sending' THEN RETURN false; END IF;

  UPDATE weekly_brief_sends
     SET status='sent', sent_at=now(), provider_id=p_provider_id,
         brief_id=coalesce(p_brief_id, brief_id), last_error=NULL,
         lease_until=NULL, updated_at=now()
   WHERE id=row.id;

  IF p_brief_id IS NOT NULL THEN
    UPDATE weekly_briefs SET sent_at=now()
     WHERE id=p_brief_id AND client_id=p_client_id AND sent_at IS NULL;
  END IF;
  RETURN true;
END $$;

-- ── Release ─────────────────────────────────────────────────────────────────
-- A definite non-send: suppressed recipient, missing postal address, no API
-- key, or a provider rejection. Nothing reached the inbox, so the next run may
-- claim it again.
CREATE OR REPLACE FUNCTION release_weekly_brief_send(
  p_client_id uuid,
  p_week_start date,
  p_error text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE row weekly_brief_sends;
BEGIN
  SELECT * INTO row FROM weekly_brief_sends
   WHERE client_id=p_client_id AND week_start=p_week_start FOR UPDATE;
  IF NOT FOUND OR row.status<>'sending' THEN RETURN false; END IF;

  UPDATE weekly_brief_sends
     SET status='failed', last_error=p_error, lease_until=NULL, updated_at=now()
   WHERE id=row.id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION claim_weekly_brief_send(uuid,date,integer),
  finish_weekly_brief_send(uuid,date,uuid,text),
  release_weekly_brief_send(uuid,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_weekly_brief_send(uuid,date,integer),
  finish_weekly_brief_send(uuid,date,uuid,text),
  release_weekly_brief_send(uuid,date,text) TO service_role;
