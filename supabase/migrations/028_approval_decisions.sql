ALTER TABLE approvals_queue ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE approvals_queue ADD COLUMN IF NOT EXISTS resolved_by uuid;
ALTER TABLE approvals_queue ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'not_executed';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_approved_at timestamptz;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_approved_by uuid;
REVOKE INSERT, UPDATE, DELETE ON approvals_queue, reviews FROM anon, authenticated;

CREATE OR REPLACE FUNCTION resolve_approval(p_client_id uuid,p_id uuid,p_user_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item approvals_queue%ROWTYPE;
BEGIN
  IF p_action NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO item FROM approvals_queue WHERE id=p_id AND client_id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF item.status=p_action THEN RETURN jsonb_build_object('outcome','unchanged','status',item.status,'execution_status',item.execution_status); END IF;
  IF item.status <> 'pending' THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
  IF item.expires_at < now() THEN RETURN jsonb_build_object('outcome','expired'); END IF;
  UPDATE approvals_queue SET status=p_action,resolved_by=p_user_id,resolved_at=now(),
    execution_status=CASE WHEN p_action='approved' THEN 'awaiting_execution' ELSE 'not_executed' END
    WHERE id=p_id;
  RETURN jsonb_build_object('outcome','resolved','status',p_action,'execution_status',
    CASE WHEN p_action='approved' THEN 'awaiting_execution' ELSE 'not_executed' END);
END $$;
REVOKE ALL ON FUNCTION resolve_approval(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION resolve_approval(uuid,uuid,uuid,text) TO service_role;
