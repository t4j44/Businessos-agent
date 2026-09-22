BEGIN;
CREATE OR REPLACE FUNCTION public.resolve_contact(
  p_client_id uuid, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_name text DEFAULT NULL, p_source text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE by_email public.contacts; by_phone public.contacts; found_contact public.contacts;
BEGIN
  p_email := nullif(lower(trim(p_email)), '');
  p_phone := nullif(trim(p_phone), '');
  IF p_client_id IS NULL OR (p_email IS NULL AND p_phone IS NULL) THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('contact:' || p_client_id::text, 0));
  SELECT * INTO by_email FROM public.contacts WHERE client_id = p_client_id AND lower(email) = p_email LIMIT 1;
  SELECT * INTO by_phone FROM public.contacts WHERE client_id = p_client_id AND phone = p_phone LIMIT 1;
  IF by_email.id IS NOT NULL AND by_phone.id IS NOT NULL AND by_email.id <> by_phone.id THEN RETURN NULL; END IF;
  found_contact := CASE WHEN by_email.id IS NOT NULL THEN by_email ELSE by_phone END;
  -- Contradictory identifiers require human resolution. Never join two people
  -- merely because one claimed the other's phone/email in a public channel.
  IF found_contact.id IS NOT NULL THEN
    IF (p_email IS NOT NULL AND found_contact.email IS NOT NULL AND lower(found_contact.email) <> p_email)
      OR (p_phone IS NOT NULL AND found_contact.phone IS NOT NULL AND found_contact.phone <> p_phone) THEN RETURN NULL; END IF;
    UPDATE public.contacts SET name = coalesce(name, nullif(trim(p_name), '')), updated_at = now()
      WHERE id = found_contact.id AND client_id = p_client_id RETURNING * INTO found_contact;
  ELSE
    INSERT INTO public.contacts(client_id, email, phone, name, source, score, status)
      VALUES(p_client_id, p_email, p_phone, nullif(trim(p_name), ''), p_source, 0, 'active')
      RETURNING * INTO found_contact;
  END IF;
  RETURN jsonb_build_object('id', found_contact.id, 'score', found_contact.score, 'status', found_contact.status);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_contact(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_contact(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.adjust_contact_score(p_client_id uuid, p_contact_id uuid, p_delta integer)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.contacts SET score = greatest(0, least(100, coalesce(score, 0) + p_delta)), updated_at = now()
    WHERE id = p_contact_id AND client_id = p_client_id AND p_delta BETWEEN -100 AND 100;
$$;
REVOKE ALL ON FUNCTION public.adjust_contact_score(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_contact_score(uuid, uuid, integer) TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_client_unique ON public.contacts(id, client_id);
-- Existing rows are retained. New writes cannot link a contact across tenants.
ALTER TABLE public.contact_interactions ADD CONSTRAINT interaction_contact_tenant
  FOREIGN KEY (contact_id, client_id) REFERENCES public.contacts(id, client_id) NOT VALID;
CREATE INDEX IF NOT EXISTS interactions_tenant_contact ON public.contact_interactions(client_id, contact_id, created_at DESC);
REVOKE INSERT, UPDATE, DELETE ON public.contacts, public.contact_interactions, public.clients FROM anon, authenticated;
COMMIT;
