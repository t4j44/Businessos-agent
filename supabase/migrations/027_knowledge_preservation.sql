-- Owner corrections survive subsequent extraction. Legacy editable values are
-- protected conservatively: earlier releases did not record their provenance.
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS owner_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE brand_profiles b SET owner_overrides = jsonb_strip_nulls(jsonb_build_object(
  'company_name',b.company_name,'icp_summary',b.icp_summary,
  'tone_description',b.tone_description,'tone_type',b.tone_type,
  'value_proposition',b.value_proposition,'greeting_text',b.greeting_text,
  'brand_colors',b.brand_colors,'products_json',b.products_json,
  'pain_points_json',b.pain_points_json,'competitors_json',b.competitors_json,
  'faq_json',b.faq_json
)) WHERE owner_overrides = '{}'::jsonb;

CREATE OR REPLACE FUNCTION preserve_brand_corrections() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW := jsonb_populate_record(NEW, NEW.owner_overrides);
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_brand_corrections BEFORE UPDATE ON brand_profiles
FOR EACH ROW EXECUTE FUNCTION preserve_brand_corrections();

CREATE OR REPLACE FUNCTION edit_brand_field(p_client_id uuid, p_field text, p_value jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_field NOT IN ('company_name','icp_summary','tone_description','tone_type',
    'value_proposition','greeting_text','brand_colors','products_json','pain_points_json',
    'competitors_json','faq_json') THEN RAISE EXCEPTION 'Unsupported brand field'; END IF;
  IF octet_length(p_value::text) > 16000 THEN RAISE EXCEPTION 'Brand field too large'; END IF;
  IF p_field IN ('products_json','pain_points_json','competitors_json','faq_json') THEN
    IF jsonb_typeof(p_value) <> 'array' THEN RAISE EXCEPTION 'Expected array'; END IF;
  ELSIF jsonb_typeof(p_value) <> 'string' THEN RAISE EXCEPTION 'Expected text'; END IF;
  IF p_field = 'tone_type' AND p_value #>> '{}' NOT IN ('formal','casual','technical') THEN
    RAISE EXCEPTION 'Invalid tone'; END IF;
  UPDATE brand_profiles SET owner_overrides = owner_overrides || jsonb_build_object(p_field,p_value)
    WHERE client_id = p_client_id;
  RETURN FOUND;
END $$;

-- Replace only this extractor's rows, in one transaction. Manual and legacy
-- unclassified rows remain intact. Changed facts require a new public approval.
CREATE OR REPLACE FUNCTION replace_brand_chunks(p_client_id uuid, p_source_url text, p_chunks jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, extensions AS $$
DECLARE item jsonb; batch text := gen_random_uuid()::text; prior rag_chunks%ROWTYPE; n integer := 0;
BEGIN
  IF jsonb_typeof(p_chunks) <> 'array' OR jsonb_array_length(p_chunks) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Expected 1 to 80 chunks'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('brand:' || p_client_id::text,0));
  FOR item IN SELECT value FROM jsonb_array_elements(p_chunks) LOOP
    IF length(trim(item->>'content')) = 0 OR item->>'chunk_type' NOT IN ('brand','icp','voice')
      OR jsonb_array_length(item->'embedding') <> 1024 THEN RAISE EXCEPTION 'Invalid chunk'; END IF;
    SELECT * INTO prior FROM rag_chunks WHERE client_id=p_client_id AND source_agent='brand_scout'
      AND is_active AND content=item->>'content' AND chunk_type=item->>'chunk_type'
      ORDER BY approved_at DESC NULLS LAST LIMIT 1;
    INSERT INTO rag_chunks(client_id,content,embedding,chunk_type,source_agent,source_url,metadata,
      is_active,visibility,approved_at,approved_by)
    VALUES(p_client_id,item->>'content',(item->'embedding')::text::vector,item->>'chunk_type',
      'brand_scout',p_source_url,jsonb_build_object('batch',batch,'retrieved_at',now(),
      'evidence_kind',coalesce(item->>'evidence_kind','extracted'),'verification','owner_review_required'),
      true,coalesce(prior.visibility,'internal'),prior.approved_at,prior.approved_by);
    n := n+1;
  END LOOP;
  UPDATE rag_chunks SET is_active=false WHERE client_id=p_client_id AND source_agent='brand_scout'
    AND is_active AND metadata->>'batch' IS DISTINCT FROM batch;
  RETURN n;
END $$;
REVOKE INSERT, UPDATE, DELETE ON brand_profiles, rag_chunks FROM anon, authenticated;
REVOKE ALL ON FUNCTION preserve_brand_corrections() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION edit_brand_field(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION replace_brand_chunks(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION edit_brand_field(uuid,text,jsonb), replace_brand_chunks(uuid,text,jsonb) TO service_role;
