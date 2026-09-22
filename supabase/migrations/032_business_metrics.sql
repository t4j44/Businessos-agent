-- Aggregate in PostgreSQL so API row limits cannot silently truncate totals.
CREATE OR REPLACE FUNCTION business_metrics(p_client_id uuid,p_since timestamptz,p_until timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE calls jsonb; reviews_data jsonb; invoices_data jsonb; runs jsonb; contacts_data jsonb;
BEGIN
  IF p_since IS NULL OR p_until IS NULL OR p_since >= p_until OR p_until-p_since > interval '366 days' THEN
    RAISE EXCEPTION 'Invalid reporting period'; END IF;
  SELECT jsonb_build_object('total',count(*),'resolved',count(*) FILTER(WHERE resolved),
    'escalated',count(*) FILTER(WHERE escalated),'pending_analysis',count(*) FILTER(WHERE analysis_status='pending'),
    'avg_sentiment',round(avg(sentiment_score) FILTER(WHERE sentiment_score BETWEEN 0 AND 100)),
    'sentiment_samples',count(sentiment_score) FILTER(WHERE sentiment_score BETWEEN 0 AND 100)) INTO calls
    FROM call_transcripts WHERE client_id=p_client_id AND created_at>=p_since AND created_at<p_until;
  calls := calls || jsonb_build_object('by_day',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.date),'[]') FROM (
    SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,
      to_char(created_at AT TIME ZONE 'UTC','Dy') AS day,
      count(*) FILTER(WHERE resolved) resolved,count(*) FILTER(WHERE escalated) escalated
    FROM call_transcripts WHERE client_id=p_client_id AND created_at>=p_since AND created_at<p_until
    GROUP BY 1,2) d));
  SELECT jsonb_build_object('total',count(*),'responded',count(*) FILTER(WHERE responded),
    'avg_rating',round(avg(star_rating) FILTER(WHERE star_rating BETWEEN 1 AND 5),1),
    'by_sentiment',jsonb_build_object('positive',count(*) FILTER(WHERE star_rating>=4),
      'neutral',count(*) FILTER(WHERE star_rating=3),'negative',count(*) FILTER(WHERE star_rating BETWEEN 1 AND 2))) INTO reviews_data
    FROM reviews WHERE client_id=p_client_id AND created_at>=p_since AND created_at<p_until;
  SELECT jsonb_build_object(
    'total',count(*) FILTER(WHERE due_date>=p_since::date AND due_date<p_until::date AND status NOT IN ('draft','cancelled','void')),
    'paid',count(*) FILTER(WHERE due_date>=p_since::date AND due_date<p_until::date AND status='paid' AND paid_at<p_until),
    'overdue',count(*) FILTER(WHERE status IN ('sent','overdue') AND due_date<p_until::date),
    'sum_amount_due',coalesce(sum(amount_cents) FILTER(WHERE status IN ('sent','overdue')),0)/100.0,
    'collected_in_period',coalesce(sum(amount_cents) FILTER(WHERE status='paid' AND paid_at>=p_since AND paid_at<p_until),0)/100.0,
    'missing_payment_dates',count(*) FILTER(WHERE status='paid' AND paid_at IS NULL),
    'cohort','invoices due in reporting period; cash collections use paid_at') INTO invoices_data
    FROM invoices WHERE client_id=p_client_id AND created_at<p_until;
  invoices_data := invoices_data || jsonb_build_object('by_stage',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM (
    SELECT chase_step step,count(*) count FROM invoices WHERE client_id=p_client_id
      AND status IN ('sent','overdue') AND created_at<p_until GROUP BY chase_step ORDER BY chase_step) d));
  SELECT jsonb_build_object('total',count(*),'sum_cost_usd',coalesce(sum(cost_usd),0),
    'completed',count(*) FILTER(WHERE status IN ('completed','success')),
    'failed',count(*) FILTER(WHERE status IN ('failed','error')),
    'cost_scope','recorded AI costs only; excludes unrecorded provider and infrastructure costs') INTO runs
    FROM agent_runs WHERE client_id=p_client_id AND created_at>=p_since AND created_at<p_until;
  runs := runs || jsonb_build_object('by_type',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM (
    SELECT agent_type type,count(*) count,coalesce(sum(cost_usd),0) cost,max(created_at) last_run_at,
      (array_agg(status ORDER BY created_at DESC,id DESC))[1] last_status
    FROM agent_runs WHERE client_id=p_client_id AND created_at>=p_since AND created_at<p_until GROUP BY agent_type) d));
  SELECT jsonb_build_object('at_risk',count(*),'definition','score below 30 with a recorded negative interaction in the reporting period') INTO contacts_data
    FROM contacts c WHERE c.client_id=p_client_id AND c.score<30 AND EXISTS(
      SELECT 1 FROM contact_interactions i WHERE i.contact_id=c.id AND i.client_id=p_client_id
      AND i.sentiment_score<50 AND i.created_at>=p_since AND i.created_at<p_until);
  RETURN jsonb_build_object('calls',calls,'reviews',reviews_data,'invoices',invoices_data,
    'agent_runs',runs,'contacts',contacts_data,'period',jsonb_build_object('since',p_since,'until',p_until,'timezone','UTC'),
    'source_tables',jsonb_build_array('call_transcripts','reviews','invoices','agent_runs','contacts','contact_interactions'));
END $$;
REVOKE ALL ON FUNCTION business_metrics(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION business_metrics(uuid,timestamptz,timestamptz) TO service_role;
