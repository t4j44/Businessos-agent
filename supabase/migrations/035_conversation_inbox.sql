BEGIN;
CREATE TABLE public.widget_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  session_key text NOT NULL CHECK(session_key ~ '^[a-f0-9]{64}$'),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  last_message_preview text,
  message_count integer NOT NULL DEFAULT 0,
  handoff_status text NOT NULL DEFAULT 'none' CHECK(handoff_status IN ('none','requested','resolved')),
  handoff_request_key uuid,
  handoff_fingerprint text,
  visitor_name text,
  visitor_email text,
  visitor_phone text,
  handoff_reason text,
  requested_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  UNIQUE(client_id,session_key)
);
CREATE INDEX conversation_inbox ON public.widget_conversations(client_id,last_activity_at DESC,id DESC);
CREATE INDEX conversation_handoffs ON public.widget_conversations(client_id,last_activity_at DESC) WHERE handoff_status='requested';
ALTER TABLE public.widget_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.widget_conversations FROM anon,authenticated;
GRANT SELECT ON public.widget_conversations TO authenticated;
GRANT ALL ON public.widget_conversations TO service_role;
CREATE POLICY owner_conversation_read ON public.widget_conversations FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM public.clients c WHERE c.id=widget_conversations.client_id AND c.user_id=auth.uid()));

INSERT INTO public.widget_conversations(client_id,session_key,last_activity_at,last_message_at,last_message_preview,message_count)
SELECT client_id,session_key,max(created_at),max(created_at),
  (array_agg(left(content,180) ORDER BY created_at DESC,id DESC))[1],count(*)::integer
FROM public.widget_messages GROUP BY client_id,session_key;

CREATE FUNCTION public.track_widget_conversation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  INSERT INTO widget_conversations(client_id,session_key,last_activity_at,last_message_at,last_message_preview,message_count)
  VALUES(NEW.client_id,NEW.session_key,NEW.created_at,NEW.created_at,left(NEW.content,180),1)
  ON CONFLICT(client_id,session_key) DO UPDATE SET
    message_count=widget_conversations.message_count+1,
    last_activity_at=greatest(widget_conversations.last_activity_at,NEW.created_at),
    last_message_at=greatest(widget_conversations.last_message_at,NEW.created_at),
    last_message_preview=CASE WHEN widget_conversations.last_message_at IS NULL OR NEW.created_at>=widget_conversations.last_message_at
      THEN left(NEW.content,180) ELSE widget_conversations.last_message_preview END
    WHERE widget_conversations.handoff_status<>'requested';
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is awaiting human help'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER track_widget_conversation AFTER INSERT ON public.widget_messages
FOR EACH ROW EXECUTE FUNCTION public.track_widget_conversation();

CREATE FUNCTION public.request_widget_handoff(p_client_id uuid,p_session_key text,p_request_key uuid,p_fingerprint text,
  p_name text,p_email text,p_phone text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item widget_conversations%ROWTYPE;
BEGIN
  IF p_request_key IS NULL OR p_session_key IS NULL OR p_session_key !~ '^[a-f0-9]{64}$'
    OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
    OR length(coalesce(p_reason,'')) NOT BETWEEN 1 AND 1000 OR length(coalesce(p_name,''))>100
    OR length(coalesce(p_email,''))>254 OR length(coalesce(p_phone,''))>16
    OR (nullif(p_email,'') IS NULL AND nullif(p_phone,'') IS NULL) THEN RAISE EXCEPTION 'Invalid handoff request'; END IF;
  IF NOT EXISTS(SELECT 1 FROM clients WHERE id=p_client_id AND status IN ('active','trial','pilot')) THEN
    RETURN jsonb_build_object('outcome','inactive'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('handoff:'||p_client_id::text||':'||p_session_key,0));
  INSERT INTO widget_conversations(client_id,session_key) VALUES(p_client_id,p_session_key) ON CONFLICT DO NOTHING;
  SELECT * INTO item FROM widget_conversations WHERE client_id=p_client_id AND session_key=p_session_key FOR UPDATE;
  IF item.handoff_request_key=p_request_key THEN
    RETURN jsonb_build_object('outcome',CASE WHEN item.handoff_fingerprint=p_fingerprint THEN 'unchanged' ELSE 'conflict' END,'id',item.id,'status',item.handoff_status); END IF;
  IF item.handoff_status='requested' THEN RETURN jsonb_build_object('outcome','pending','id',item.id,'status','requested'); END IF;
  UPDATE widget_conversations SET handoff_status='requested',handoff_request_key=p_request_key,handoff_fingerprint=p_fingerprint,
    visitor_name=nullif(p_name,''),visitor_email=nullif(p_email,''),visitor_phone=nullif(p_phone,''),handoff_reason=p_reason,
    requested_at=now(),last_activity_at=now(),resolved_at=null,resolved_by=null WHERE id=item.id;
  RETURN jsonb_build_object('outcome','requested','id',item.id,'status','requested');
END $$;

CREATE FUNCTION public.resolve_widget_handoff(p_client_id uuid,p_id uuid,p_request_key uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item widget_conversations%ROWTYPE;
BEGIN
  SELECT w.* INTO item FROM widget_conversations w JOIN clients c ON c.id=w.client_id
    WHERE w.client_id=p_client_id AND w.id=p_id AND c.user_id=p_user_id FOR UPDATE OF w;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF p_request_key IS NULL OR item.handoff_request_key IS DISTINCT FROM p_request_key OR item.handoff_status='none' THEN
    RETURN jsonb_build_object('outcome','conflict'); END IF;
  IF item.handoff_status='resolved' THEN RETURN jsonb_build_object('outcome','unchanged'); END IF;
  UPDATE widget_conversations SET handoff_status='resolved',resolved_at=now(),resolved_by=p_user_id WHERE id=p_id;
  RETURN jsonb_build_object('outcome','resolved');
END $$;
REVOKE ALL ON FUNCTION public.track_widget_conversation(),
  public.request_widget_handoff(uuid,text,uuid,text,text,text,text,text),public.resolve_widget_handoff(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_widget_handoff(uuid,text,uuid,text,text,text,text,text),
  public.resolve_widget_handoff(uuid,uuid,uuid,uuid) TO service_role;
COMMIT;
