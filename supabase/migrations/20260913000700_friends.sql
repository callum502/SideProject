BEGIN;
CREATE TABLE private.friendships (
 sender uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 recipient uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(sender<>recipient),
 PRIMARY KEY(sender,recipient)
);
CREATE UNIQUE INDEX friendships_pair ON private.friendships(least(sender,recipient),greatest(sender,recipient));
ALTER TABLE private.friendships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.friendships FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.friends_action(action text,target uuid DEFAULT NULL,query_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); result jsonb;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Log in first'; END IF;
 IF action='search' THEN
  IF query_name IS NULL OR length(btrim(query_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter a display name'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) INTO result FROM (
   SELECT id,display_name FROM public.profiles WHERE id<>me AND lower(display_name)=lower(btrim(query_name)) ORDER BY id LIMIT 20
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
REVOKE ALL ON FUNCTION public.friends_action(text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.friends_action(text,uuid,text) TO authenticated;
COMMIT;
