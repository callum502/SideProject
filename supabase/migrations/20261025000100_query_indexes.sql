BEGIN;
-- Indexes for lookups that otherwise scan a whole table as it grows.
-- Location photos: the location media limit trigger, per-location reads, and the foreign key check when a location
-- is removed.
CREATE INDEX media_location_idx ON public.media(location_id) WHERE location_id IS NOT NULL;
-- Removing a problem sets problem_id to NULL on every logbook entry for it (ON DELETE SET NULL).
CREATE INDEX problem_logs_problem_idx ON private.problem_logs(problem_id);
-- Friend lists and incoming invites look up rows by recipient; the primary key only covers sender.
CREATE INDEX friendships_recipient_idx ON private.friendships(recipient);
-- media_file_in_use checks whether a file is someone's profile photo before Storage deletes it.
CREATE INDEX profile_photos_path_idx ON private.profile_photos(storage_path);

-- Friend suggestions match any part of a display name. A trigram index serves that substring search; strpos could
-- not use an index. Queries under 3 characters still scan, but return at most 20 rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX profiles_display_name_trgm ON public.profiles USING gin (lower(display_name) extensions.gin_trgm_ops);
CREATE OR REPLACE FUNCTION public.search_friend_profiles(query_name text) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pattern text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in first' USING ERRCODE='42501'; END IF;
 IF query_name IS NULL OR length(btrim(query_name)) NOT BETWEEN 1 AND 120 THEN RETURN; END IF;
 -- % and _ in a name are matched literally, as strpos did.
 pattern:='%' || replace(replace(replace(lower(btrim(query_name)),'\','\\'),'%','\%'),'_','\_') || '%';
 RETURN QUERY SELECT p.id,p.display_name FROM public.profiles p
 WHERE p.id<>auth.uid() AND lower(p.display_name) LIKE pattern
 ORDER BY (lower(p.display_name)=lower(btrim(query_name))) DESC,lower(p.display_name),p.id LIMIT 20;
END $$;

-- Exact-name search now compares lower(btrim(display_name)), the expression profiles_display_name_unique indexes.
-- Display names are stored trimmed (complete_profile), so the results are the same.
CREATE OR REPLACE FUNCTION public.friends_action(action text,target uuid DEFAULT NULL,query_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); result jsonb;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Log in first'; END IF;
 IF action='search' THEN
  IF query_name IS NULL OR length(btrim(query_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter a display name'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) INTO result FROM (
   SELECT id,display_name FROM public.profiles WHERE id<>me AND lower(btrim(display_name))=lower(btrim(query_name)) ORDER BY id LIMIT 20
  ) p;
  RETURN result;
 ELSIF action='logbook' THEN
  IF NOT EXISTS(SELECT 1 FROM private.friendships WHERE status='accepted' AND ((sender=me AND recipient=target) OR (sender=target AND recipient=me))) THEN RAISE EXCEPTION 'Only accepted friends can view this logbook'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('mutual',EXISTS(SELECT 1 FROM private.problem_logs own WHERE own.user_id=me AND own.problem_id=l.problem_id)) ORDER BY l.logged_at DESC,l.entry_id),'[]'::jsonb) INTO result FROM private.problem_logs l WHERE l.user_id=target;
  RETURN jsonb_build_object('name',(SELECT display_name FROM public.profiles WHERE id=target),'entries',result);
 ELSIF action='request' THEN
  IF target IS NULL OR target=me OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=target) THEN RAISE EXCEPTION 'Choose another climber'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(me::text,0));
  IF (SELECT count(*) FROM private.friendships WHERE sender=me AND status='pending')>=50 THEN RAISE EXCEPTION 'Too many pending invites'; END IF;
  INSERT INTO private.friendships(sender,recipient) VALUES(me,target) ON CONFLICT DO NOTHING;
 ELSIF action='accept' THEN
  UPDATE private.friendships SET status='accepted' WHERE sender=target AND recipient=me AND status='pending';
 ELSIF action='decline' THEN
  DELETE FROM private.friendships WHERE sender=target AND recipient=me AND status='pending';
 ELSIF action='remove' THEN
  DELETE FROM private.friendships WHERE (sender=me AND recipient=target) OR (sender=target AND recipient=me);
 ELSIF action IS DISTINCT FROM 'list' THEN RAISE EXCEPTION 'Invalid action';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'status',f.status,'incoming',f.recipient=me) ORDER BY p.display_name,p.id),'[]'::jsonb) INTO result
 FROM private.friendships f JOIN public.profiles p ON p.id=CASE WHEN f.sender=me THEN f.recipient ELSE f.sender END WHERE f.sender=me OR f.recipient=me;
 RETURN result;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
