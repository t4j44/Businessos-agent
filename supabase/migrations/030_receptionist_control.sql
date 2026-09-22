CREATE OR REPLACE FUNCTION set_receptionist_enabled(p_client_id uuid,p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'An enabled state is required'; END IF;
  UPDATE clients SET settings_json = coalesce(settings_json,'{}'::jsonb) || jsonb_build_object('agents',
    coalesce(settings_json->'agents','{}'::jsonb) || jsonb_build_object('receptionist',
      coalesce(settings_json->'agents'->'receptionist','{}'::jsonb) || jsonb_build_object('enabled',p_enabled)))
    WHERE id=p_client_id;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION set_receptionist_enabled(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION set_receptionist_enabled(uuid,boolean) TO service_role;
