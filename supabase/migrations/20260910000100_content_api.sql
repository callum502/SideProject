-- Content API: consistent snapshots and atomic, RLS-protected edits.
BEGIN;
-- Until the Storage migration, every media URL must be a supported local upload.
-- Enforce this for direct REST writes as well as the Node API.
ALTER TABLE public.media ADD CONSTRAINT media_local_reference CHECK (
  storage_bucket = 'local'
  AND storage_path ~ '^[a-f0-9-]+\.(png|jpg|webp|mp4|webm|mov)$'
  AND mime_type = CASE substring(storage_path from '\.([^.]+)$')
    WHEN 'png' THEN 'image/png' WHEN 'jpg' THEN 'image/jpeg' WHEN 'webp' THEN 'image/webp'
    WHEN 'mp4' THEN 'video/mp4' WHEN 'webm' THEN 'video/webm' WHEN 'mov' THEN 'video/quicktime'
  END
);
CREATE TABLE private.content_state (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
INSERT INTO private.content_state DEFAULT VALUES;
REVOKE ALL ON private.content_state FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.content_revision() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT revision FROM private.content_state WHERE singleton $$;
REVOKE ALL ON FUNCTION private.content_revision() FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO anon;
GRANT EXECUTE ON FUNCTION private.content_revision() TO anon, authenticated;

CREATE FUNCTION private.lock_content_revision(expected bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actual bigint;
BEGIN
  SELECT revision INTO actual FROM private.content_state WHERE singleton FOR UPDATE;
  IF expected IS NULL OR expected <> actual THEN
    RAISE EXCEPTION 'This guide changed. Reload before saving again.' USING ERRCODE = '40001';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.lock_content_revision(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.lock_content_revision(bigint) TO authenticated;

CREATE FUNCTION private.bump_content_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private.content_state SET revision = revision + 1 WHERE singleton;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.bump_content_revision() FROM PUBLIC, anon, authenticated;
-- BEFORE STATEMENT obtains the same lock even for writes made directly through REST/SQL.
CREATE TRIGGER content_revision BEFORE INSERT OR UPDATE OR DELETE ON public.locations FOR EACH STATEMENT EXECUTE FUNCTION private.bump_content_revision();
CREATE TRIGGER content_revision BEFORE INSERT OR UPDATE OR DELETE ON public.boulders FOR EACH STATEMENT EXECUTE FUNCTION private.bump_content_revision();
CREATE TRIGGER content_revision BEFORE INSERT OR UPDATE OR DELETE ON public.problems FOR EACH STATEMENT EXECUTE FUNCTION private.bump_content_revision();
CREATE TRIGGER content_revision BEFORE INSERT OR UPDATE OR DELETE ON public.media FOR EACH STATEMENT EXECUTE FUNCTION private.bump_content_revision();
CREATE TRIGGER content_revision BEFORE INSERT OR UPDATE OR DELETE ON public.problem_media FOR EACH STATEMENT EXECUTE FUNCTION private.bump_content_revision();
CREATE TRIGGER content_revision BEFORE INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH STATEMENT EXECUTE FUNCTION private.bump_content_revision();

CREATE FUNCTION public.read_content() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT jsonb_build_object('revision', private.content_revision(),
'locations', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id) FROM public.locations t), '[]'::jsonb),
'boulders', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id) FROM public.boulders t), '[]'::jsonb),
'problems', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id) FROM public.problems t), '[]'::jsonb),
'media', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id) FROM public.media t), '[]'::jsonb),
'problem_media', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.problem_id, t.media_id) FROM public.problem_media t), '[]'::jsonb), 'profiles', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'display_name',display_name)) FROM public.profiles), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.read_content() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_content() TO anon, authenticated;

CREATE FUNCTION public.save_content(expected_revision bigint, operations jsonb) RETURNS jsonb
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
      WHEN 'boulders' THEN cols := ARRAY['id','location_id','name','finding_notes','created_by'];
      WHEN 'problems' THEN cols := ARRAY['id','boulder_id','name','grade','description','created_by'];
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
