BEGIN;
CREATE TABLE IF NOT EXISTS public.voice_agents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phone_number text NOT NULL UNIQUE CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'testing', 'live', 'paused', 'error')),
  config_json jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  verified_at timestamptz,
  last_verified_call_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, client_id)
);
ALTER TABLE public.voice_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY voice_agents_owner_read ON public.voice_agents FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()));
REVOKE ALL ON public.voice_agents FROM anon, authenticated;
GRANT SELECT ON public.voice_agents TO authenticated;
GRANT ALL ON public.voice_agents TO service_role;

CREATE TABLE IF NOT EXISTS public.voice_webhook_receipts (
  call_id text PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  voice_agent_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(voice_agent_id, client_id) REFERENCES public.voice_agents(id, client_id)
);
ALTER TABLE public.voice_webhook_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_webhook_receipts FROM anon, authenticated;
GRANT ALL ON public.voice_webhook_receipts TO service_role;
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS analysis_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id);
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS caller_number text;
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS resolved boolean NOT NULL DEFAULT false;
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS escalation_reason text;

CREATE OR REPLACE FUNCTION public.ingest_voice_call(
  p_client_id uuid, p_voice_agent_id uuid, p_call_id text, p_caller text,
  p_duration_sec integer, p_transcript text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE receipt_id text; contact_uuid uuid; transcript_uuid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.voice_agents WHERE id = p_voice_agent_id AND client_id = p_client_id AND verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid voice mapping';
  END IF;
  INSERT INTO public.voice_webhook_receipts(call_id, client_id, voice_agent_id)
    VALUES(p_call_id, p_client_id, p_voice_agent_id) ON CONFLICT DO NOTHING RETURNING call_id INTO receipt_id;
  IF receipt_id IS NULL THEN RETURN jsonb_build_object('created', false); END IF;
  IF EXISTS (SELECT 1 FROM public.call_transcripts WHERE bland_call_id = p_call_id) THEN
    RETURN jsonb_build_object('created', false);
  END IF;
  IF p_caller IS NOT NULL THEN
    INSERT INTO public.contacts(client_id, phone, source) VALUES(p_client_id, p_caller, 'call_center')
      ON CONFLICT (client_id, phone) WHERE phone IS NOT NULL DO UPDATE SET updated_at = now()
      RETURNING id INTO contact_uuid;
  END IF;
  INSERT INTO public.call_transcripts(client_id, bland_call_id, caller_number, duration_sec, transcript,
    summary, sentiment_score, resolved, escalated, direction, contact_id, analysis_status)
    VALUES(p_client_id, p_call_id, p_caller, p_duration_sec, p_transcript,
      'Call saved. Analysis pending.', NULL, false, false, 'inbound', contact_uuid, 'pending') RETURNING id INTO transcript_uuid;
  IF contact_uuid IS NOT NULL THEN
    INSERT INTO public.contact_interactions(contact_id, client_id, agent_name, interaction_type, summary, metadata)
      VALUES(contact_uuid, p_client_id, 'call_center', 'call', 'Inbound call received. Analysis pending.',
        jsonb_build_object('call_id', p_call_id, 'transcript_id', transcript_uuid, 'duration_sec', p_duration_sec));
  END IF;
  UPDATE public.voice_agents SET last_verified_call_at=now() WHERE id=p_voice_agent_id AND client_id=p_client_id;
  RETURN jsonb_build_object('created', true, 'transcript_id', transcript_uuid);
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_voice_call(uuid, uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_voice_call(uuid, uuid, text, text, integer, text) TO service_role;
COMMIT;
