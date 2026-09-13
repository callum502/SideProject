BEGIN;
CREATE FUNCTION private.valid_location_links(links jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE link jsonb;
BEGIN
 IF jsonb_typeof(links) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(links)>50 THEN RETURN false; END IF;
 FOR link IN SELECT value FROM jsonb_array_elements(links) LOOP
  IF jsonb_typeof(link->'label') IS DISTINCT FROM 'string' OR length(btrim(link->>'label'))=0 OR length(link->>'label')>120
   OR jsonb_typeof(link->'url') IS DISTINCT FROM 'string' OR length(link->>'url')>2048
   OR (link->>'url') !~* '^https?://[^/@[:space:]]+([/?#][^[:space:]]*)?$' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.valid_location_links(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.valid_location_links(jsonb) TO authenticated;
ALTER TABLE public.locations ADD COLUMN additional_links jsonb NOT NULL DEFAULT '[]' CHECK(private.valid_location_links(additional_links));
CREATE OR REPLACE FUNCTION public.save_content(expected_revision bigint, operations jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE op jsonb; tbl text; cols text[]; col_list text; select_list text; assignments text; predicate text; affected integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in to contribute.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(operations) IS DISTINCT FROM 'array' OR jsonb_array_length(operations) > 10000 THEN
    RAISE EXCEPTION 'Invalid operation list' USING ERRCODE = '22023';
  END IF;
  PERFORM private.lock_content_revision(expected_revision);
  FOR op IN SELECT value FROM jsonb_array_elements(operations) LOOP
    tbl := op->>'table';
    CASE tbl
      WHEN 'locations' THEN cols := ARRAY['id','name','latitude','longitude','approach_notes','additional_links','created_by'];
      WHEN 'boulders' THEN cols := ARRAY['id','location_id','name','finding_notes','other_notes','created_by'];
      WHEN 'problems' THEN cols := ARRAY['id','boulder_id','name','grade','description','photo_annotations','created_by'];
      WHEN 'media' THEN cols := ARRAY['id','boulder_id','location_id','caption','name','kind','storage_bucket','storage_path','mime_type','size_bytes','annotations','created_by'];
      WHEN 'problem_media' THEN cols := ARRAY['problem_id','media_id','boulder_id'];
      ELSE RAISE EXCEPTION 'Invalid content table' USING ERRCODE = '22023';
    END CASE;
    predicate := CASE WHEN tbl = 'problem_media' THEN 't.problem_id = ($1->>''problem_id'')::uuid AND t.media_id = ($1->>''media_id'')::uuid' ELSE 't.id = ($1->>''id'')::uuid' END;
    IF op->>'action' = 'delete' THEN
      EXECUTE format('DELETE FROM public.%I t WHERE %s', tbl, predicate) USING op->'row';
    ELSIF op->>'action' = 'insert' THEN
      SELECT string_agg(format('%I',c),', '), string_agg(format('r.%I',c),', ') INTO col_list, select_list FROM unnest(cols) c;
      EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) r', tbl,col_list,select_list,tbl) USING op->'row';
    ELSIF op->>'action' = 'update' AND tbl <> 'problem_media' THEN
      SELECT string_agg(format('%I = r.%I',c,c),', ') INTO assignments FROM unnest(cols) c WHERE c <> 'id';
      EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$1) r WHERE %s',tbl,assignments,tbl,predicate) USING op->'row';
    ELSE
      RAISE EXCEPTION 'Invalid content action' USING ERRCODE = '22023';
    END IF;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Record is missing or you do not have permission to change it.' USING ERRCODE = '42501'; END IF;
  END LOOP;
  RETURN public.read_content();
END $$;
REVOKE ALL ON FUNCTION public.save_content(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_content(bigint,jsonb) TO authenticated;
COMMIT;
