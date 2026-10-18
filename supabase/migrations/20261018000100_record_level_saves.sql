BEGIN;
-- Saves conflict per record instead of on one guide-wide revision, so concurrent edits
-- to different records both succeed. Updates and deletes must name the row version they
-- read (protect_record increments it on every update); inserts conflict on primary keys.
DROP TRIGGER content_revision ON public.locations;
DROP TRIGGER content_revision ON public.boulders;
DROP TRIGGER content_revision ON public.problems;
DROP TRIGGER content_revision ON public.media;
DROP TRIGGER content_revision ON public.problem_media;
DROP TRIGGER content_revision ON public.profiles;
DROP FUNCTION public.save_content(bigint,jsonb);
DROP FUNCTION private.lock_content_revision(bigint);
DROP FUNCTION private.bump_content_revision();

CREATE OR REPLACE FUNCTION public.read_content() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT jsonb_build_object(
'locations', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id) FROM public.locations t), '[]'::jsonb),
'boulders', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id) FROM public.boulders t), '[]'::jsonb),
'problems', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id) FROM public.problems t), '[]'::jsonb),
'media', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id) FROM public.media t), '[]'::jsonb),
'problem_media', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.problem_id, t.media_id) FROM public.problem_media t), '[]'::jsonb), 'profiles', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'display_name',display_name)) FROM public.profiles), '[]'::jsonb))
$$;
DROP FUNCTION private.content_revision();
DROP TABLE private.content_state;

CREATE FUNCTION public.save_content(operations jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE op jsonb; tbl text; cols text[]; col_list text; select_list text; assignments text; predicate text; affected integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in to contribute.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(operations) IS DISTINCT FROM 'array' OR jsonb_array_length(operations) > 10000 THEN
    RAISE EXCEPTION 'Invalid operation list' USING ERRCODE = '22023';
  END IF;
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
    IF op->>'action' IN ('update','delete') AND tbl <> 'problem_media' THEN
      IF jsonb_typeof(op->'row'->'version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Record version is required' USING ERRCODE = '22023'; END IF;
      predicate := predicate || ' AND t.version = ($1->>''version'')::integer';
    END IF;
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
    IF affected <> 1 THEN
      -- Still visible at the version read means RLS refused the write; otherwise it changed or was removed since.
      EXECUTE format('SELECT count(*) FROM public.%I t WHERE %s', tbl, predicate) INTO affected USING op->'row';
      IF affected = 1 THEN RAISE EXCEPTION 'Record is missing or you do not have permission to change it.' USING ERRCODE = '42501'; END IF;
      RAISE EXCEPTION 'This record changed. Reload before saving again.' USING ERRCODE = '40001';
    END IF;
  END LOOP;
  RETURN public.read_content();
END $$;
REVOKE ALL ON FUNCTION public.save_content(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_content(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
