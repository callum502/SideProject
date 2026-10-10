BEGIN;
CREATE FUNCTION public.search_friend_profiles(query_name text) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in first' USING ERRCODE='42501'; END IF;
 IF query_name IS NULL OR length(btrim(query_name)) NOT BETWEEN 1 AND 120 THEN RETURN; END IF;
 RETURN QUERY SELECT p.id,p.display_name FROM public.profiles p
 WHERE p.id<>auth.uid() AND strpos(lower(p.display_name),lower(btrim(query_name)))>0
 ORDER BY (lower(p.display_name)=lower(btrim(query_name))) DESC,lower(p.display_name),p.id LIMIT 20;
END $$;
REVOKE ALL ON FUNCTION public.search_friend_profiles(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_friend_profiles(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
