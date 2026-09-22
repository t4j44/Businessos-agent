CREATE TABLE invoice_chase_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  chase_step integer NOT NULL CHECK(chase_step BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'generating' CHECK(status IN ('generating','draft','failed')),
  message text, channel text, generation_token uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_until timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_id,chase_step)
);
ALTER TABLE invoice_chase_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON invoice_chase_drafts FOR SELECT TO authenticated
  USING(client_id IN (SELECT id FROM clients WHERE user_id=auth.uid()));
REVOKE ALL ON invoice_chase_drafts FROM anon,authenticated;
GRANT SELECT ON invoice_chase_drafts TO authenticated;
GRANT ALL ON invoice_chase_drafts TO service_role;

CREATE OR REPLACE FUNCTION claim_invoice_draft(p_client_id uuid,p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE inv invoices%ROWTYPE; draft invoice_chase_drafts%ROWTYPE; step integer; overdue integer;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id=p_invoice_id AND client_id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  overdue := current_date - inv.due_date;
  step := coalesce(inv.chase_step,0)+1;
  IF inv.status NOT IN ('sent','overdue') OR inv.due_date IS NULL OR coalesce(inv.amount_cents,0) <= 0
    OR step NOT BETWEEN 1 AND 5 OR overdue < (ARRAY[1,4,8,15,22])[step] THEN
    RETURN jsonb_build_object('outcome','ineligible'); END IF;
  SELECT * INTO draft FROM invoice_chase_drafts WHERE invoice_id=inv.id AND chase_step=step FOR UPDATE;
  IF FOUND AND (draft.status='draft' OR (draft.status='generating' AND draft.lease_until>now())) THEN
    RETURN jsonb_build_object('outcome','exists','draft_id',draft.id); END IF;
  INSERT INTO invoice_chase_drafts(client_id,invoice_id,chase_step) VALUES(p_client_id,inv.id,step)
  ON CONFLICT(invoice_id,chase_step) DO UPDATE SET status='generating',generation_token=gen_random_uuid(),lease_until=now()+interval '10 minutes'
  RETURNING * INTO draft;
  RETURN jsonb_build_object('outcome','claimed','draft_id',draft.id,'generation_token',draft.generation_token,
    'invoice',to_jsonb(inv),'days_overdue',overdue,'chase_step',step);
END $$;
REVOKE ALL ON FUNCTION claim_invoice_draft(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_invoice_draft(uuid,uuid) TO service_role;
