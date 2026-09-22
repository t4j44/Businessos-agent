ALTER TABLE appointments ADD COLUMN IF NOT EXISTS request_key uuid;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS contact_id uuid;
CREATE UNIQUE INDEX appointments_request_key ON appointments(client_id,request_key) WHERE request_key IS NOT NULL;
ALTER TABLE appointments ADD CONSTRAINT appointment_contact_tenant FOREIGN KEY(contact_id,client_id)
  REFERENCES contacts(id,client_id) NOT VALID;

CREATE OR REPLACE FUNCTION request_appointment(p_client_id uuid,p_key uuid,p_fingerprint text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item appointments%ROWTYPE; person jsonb;
BEGIN
  IF p_key IS NULL OR p_fingerprint IS NULL OR length(p_fingerprint)<>64 THEN RAISE EXCEPTION 'Missing request identity'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('appointment-request:'||p_client_id::text||p_key::text,0));
  SELECT * INTO item FROM appointments WHERE client_id=p_client_id AND request_key=p_key;
  IF FOUND THEN
    IF item.request_fingerprint<>p_fingerprint THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
    RETURN jsonb_build_object('outcome','unchanged','appointment',to_jsonb(item));
  END IF;
  person := resolve_contact(p_client_id,p_payload->>'customer_email',p_payload->>'customer_phone',p_payload->>'customer_name','scheduler');
  IF person IS NULL THEN RETURN jsonb_build_object('outcome','identity_conflict'); END IF;
  INSERT INTO appointments(client_id,request_key,request_fingerprint,contact_id,customer_name,customer_email,customer_phone,
    requested_date,requested_time,service_type,notes,status)
  VALUES(p_client_id,p_key,p_fingerprint,(person->>'id')::uuid,p_payload->>'customer_name',
    p_payload->>'customer_email',p_payload->>'customer_phone',(p_payload->>'requested_date')::date,
    p_payload->>'requested_time',p_payload->>'service_type',p_payload->>'notes','pending') RETURNING * INTO item;
  INSERT INTO contact_interactions(client_id,contact_id,agent_name,interaction_type,summary,metadata)
    VALUES(p_client_id,(person->>'id')::uuid,'scheduler','appointment_request','Appointment requested; awaiting owner confirmation.',
      jsonb_build_object('appointment_id',item.id));
  RETURN jsonb_build_object('outcome','created','appointment',to_jsonb(item));
END $$;
REVOKE ALL ON FUNCTION request_appointment(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION request_appointment(uuid,uuid,text,jsonb) TO service_role;
