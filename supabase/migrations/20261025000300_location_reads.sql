BEGIN;
-- The app loads one location at a time instead of the whole guide, so a page's cost no longer grows with the size
-- of the site. read_content stays for full exports and tests.

-- The search box and map need only each location's name and coordinates.
CREATE FUNCTION public.read_location_summaries() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'latitude',t.latitude,'longitude',t.longitude)
 ORDER BY t.created_at,t.insert_order),'[]'::jsonb) FROM public.locations t
$$;

-- One location's rows, in the same shape and order as read_content, with only their creators' profiles.
CREATE FUNCTION public.read_location(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
WITH l AS (SELECT * FROM public.locations WHERE id=target),
b AS (SELECT * FROM public.boulders WHERE location_id=target),
p AS (SELECT * FROM public.problems WHERE boulder_id IN (SELECT id FROM b)),
m AS (SELECT * FROM public.media WHERE location_id=target
 UNION ALL SELECT * FROM public.media WHERE boulder_id IN (SELECT id FROM b)),
pm AS (SELECT * FROM public.problem_media WHERE problem_id IN (SELECT id FROM p)),
creators AS (SELECT created_by FROM l UNION SELECT created_by FROM b UNION SELECT created_by FROM p UNION SELECT created_by FROM m)
SELECT jsonb_build_object(
'locations', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.insert_order) FROM l t), '[]'::jsonb),
'boulders', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.insert_order) FROM b t), '[]'::jsonb),
'problems', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.insert_order) FROM p t), '[]'::jsonb),
'media', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.insert_order) FROM m t), '[]'::jsonb),
'problem_media', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.problem_id, t.media_id) FROM pm t), '[]'::jsonb),
'profiles', coalesce((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'display_name',pr.display_name))
 FROM public.profiles pr WHERE pr.id IN (SELECT created_by FROM creators)), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.read_location_summaries(),public.read_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_location_summaries(),public.read_location(uuid) TO anon,authenticated;

-- With target_location, a save returns only that location (an empty guide once it is removed) instead of the
-- whole guide. Without it, it behaves as before.
DROP FUNCTION public.save_content(jsonb);
CREATE FUNCTION public.save_content(operations jsonb, target_location uuid DEFAULT NULL) RETURNS jsonb
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
      WHEN 'media' THEN cols := ARRAY['id','boulder_id','location_id','caption','name','kind','storage_bucket','storage_path','mime_type','size_bytes','annotations','on_boulder_page','created_by'];
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
  IF target_location IS NOT NULL THEN RETURN public.read_location(target_location); END IF;
  RETURN public.read_content();
END $$;
REVOKE ALL ON FUNCTION public.save_content(jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_content(jsonb,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
