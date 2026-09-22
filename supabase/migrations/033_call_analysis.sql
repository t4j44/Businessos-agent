ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS analysis_token uuid;
ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS analysis_lease_until timestamptz;
ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS analysis_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

CREATE OR REPLACE FUNCTION claim_call_analysis(p_client_id uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item call_transcripts%ROWTYPE; token uuid := gen_random_uuid();
BEGIN
  SELECT * INTO item FROM call_transcripts WHERE id=p_id AND client_id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF item.analysis_status='completed' THEN RETURN jsonb_build_object('outcome','completed'); END IF;
  IF item.analysis_status='processing' AND item.analysis_lease_until>now() THEN RETURN jsonb_build_object('outcome','busy'); END IF;
  IF item.analysis_attempts>=3 THEN RETURN jsonb_build_object('outcome','retry_limit'); END IF;
  IF length(trim(coalesce(item.transcript,'')))<10 THEN
    UPDATE call_transcripts SET analysis_status='unavailable' WHERE id=p_id;
    RETURN jsonb_build_object('outcome','missing_transcript'); END IF;
  UPDATE call_transcripts SET analysis_token=token,analysis_lease_until=now()+interval '5 minutes',
    analysis_status='processing',analysis_attempts=analysis_attempts+1 WHERE id=p_id;
  RETURN jsonb_build_object('outcome','claimed','token',token,'transcript',item.transcript,'attempts',item.analysis_attempts+1);
END $$;

CREATE OR REPLACE FUNCTION complete_call_analysis(p_client_id uuid,p_id uuid,p_token uuid,p_summary text,p_sentiment integer,p_outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item call_transcripts%ROWTYPE;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('resolved','escalated','unresolved')
    OR p_summary IS NULL OR length(trim(p_summary)) NOT BETWEEN 1 AND 3000
    OR (p_sentiment IS NOT NULL AND p_sentiment NOT BETWEEN 0 AND 100) THEN RAISE EXCEPTION 'Invalid analysis'; END IF;
  SELECT * INTO item FROM call_transcripts WHERE id=p_id AND client_id=p_client_id
    AND analysis_token=p_token AND analysis_status='processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE call_transcripts SET summary=p_summary,sentiment_score=p_sentiment,resolved=p_outcome='resolved',
    escalated=p_outcome='escalated',analysis_status='completed',analyzed_at=now(),analysis_lease_until=null
    WHERE id=p_id;
  UPDATE contact_interactions SET summary=p_summary,sentiment_score=p_sentiment,
    metadata=coalesce(metadata,'{}') || jsonb_build_object('analysis_source','AI transcript assessment','outcome',p_outcome)
    WHERE client_id=p_client_id AND metadata->>'transcript_id'=p_id::text;
  IF p_outcome='escalated' THEN
    INSERT INTO approvals_queue(client_id,action_type,payload_json) VALUES(p_client_id,'call_follow_up',
      jsonb_build_object('transcript_id',p_id,'summary',p_summary,'delivery_status','not_sent'));
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION claim_call_analysis(uuid,uuid), complete_call_analysis(uuid,uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_call_analysis(uuid,uuid), complete_call_analysis(uuid,uuid,uuid,text,integer,text) TO service_role;
