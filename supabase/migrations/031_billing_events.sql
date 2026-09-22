ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_event_created bigint NOT NULL DEFAULT 0;
CREATE TABLE billing_events (
  event_id text PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_created bigint NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_events FROM anon, authenticated;
GRANT ALL ON billing_events TO service_role;

CREATE OR REPLACE FUNCTION apply_billing_event(p_event_id text,p_customer_id text,p_event_created bigint,
  p_event_type text,p_status text,p_tier text,p_summary jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE account clients%ROWTYPE;
BEGIN
  SELECT * INTO account FROM clients WHERE stripe_customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unmapped'; END IF;
  IF p_status NOT IN ('active','trial','past_due','cancelled','inactive') THEN RAISE EXCEPTION 'Invalid billing state'; END IF;
  IF p_tier IS NOT NULL AND p_tier NOT IN ('starter','core','growth','scale','agency') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
  INSERT INTO billing_events(event_id,client_id,event_type,event_created,summary)
    VALUES(p_event_id,account.id,p_event_type,p_event_created,p_summary) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;
  IF p_event_created < account.billing_event_created THEN RETURN 'recorded_stale'; END IF;
  UPDATE clients SET status=p_status,plan_tier=coalesce(p_tier,plan_tier),billing_event_created=p_event_created
    WHERE id=account.id;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION apply_billing_event(text,text,bigint,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION apply_billing_event(text,text,bigint,text,text,text,jsonb) TO service_role;
