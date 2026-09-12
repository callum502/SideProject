BEGIN;
ALTER TABLE public.boulders ADD COLUMN other_notes text NOT NULL DEFAULT '' CHECK (length(other_notes) <= 10000);
-- Existing empty directions remain readable; new records and changed directions must be filled in.
CREATE FUNCTION private.require_directions() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF TG_TABLE_NAME = 'locations' THEN
  IF TG_OP = 'INSERT' OR NEW.approach_notes IS DISTINCT FROM OLD.approach_notes THEN
   IF btrim(NEW.approach_notes) = '' THEN RAISE EXCEPTION 'Approach notes are required.' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF TG_OP = 'INSERT' OR NEW.finding_notes IS DISTINCT FROM OLD.finding_notes THEN
   IF btrim(NEW.finding_notes) = '' THEN RAISE EXCEPTION 'Finding the Boulder is required.' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.require_directions() FROM PUBLIC;
CREATE TRIGGER require_directions BEFORE INSERT OR UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION private.require_directions();
CREATE TRIGGER require_directions BEFORE INSERT OR UPDATE ON public.boulders FOR EACH ROW EXECUTE FUNCTION private.require_directions();
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
      WHEN 'locations' THEN cols := ARRAY['id','name','region','latitude','longitude','approach_notes','created_by'];
      WHEN 'boulders' THEN cols := ARRAY['id','location_id','name','finding_notes','other_notes','created_by'];
      WHEN 'problems' THEN cols := ARRAY['id','boulder_id','name','grade','description','photo_annotations','created_by'];
      WHEN 'media' THEN cols := ARRAY['id','boulder_id','name','kind','storage_bucket','storage_path','mime_type','size_bytes','annotations','created_by'];
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
