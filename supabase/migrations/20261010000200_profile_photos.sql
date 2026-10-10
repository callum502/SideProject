BEGIN;
CREATE TABLE private.profile_photos (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 storage_path text NOT NULL
);
ALTER TABLE private.profile_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.profile_photos FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.profile_photo(target_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT storage_path FROM private.profile_photos WHERE user_id=target_user
$$;
CREATE FUNCTION public.set_profile_photo(target_path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in first' USING ERRCODE='42501'; END IF;
 IF target_path IS NULL THEN DELETE FROM private.profile_photos WHERE user_id=auth.uid(); RETURN; END IF;
 IF split_part(target_path,'/',1)<>auth.uid()::text OR target_path !~ '^[0-9a-f-]{36}/[0-9a-f-]+\.(png|jpg|webp)$' THEN RAISE EXCEPTION 'Invalid profile photo' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='sideproj-media' AND name=target_path AND owner_id=auth.uid()::text AND metadata->>'mimetype' IN ('image/jpeg','image/png','image/webp') AND (metadata->>'size')::bigint BETWEEN 1 AND 8388608) THEN RAISE EXCEPTION 'Upload a valid profile image first' USING ERRCODE='23514'; END IF;
 INSERT INTO private.profile_photos(user_id,storage_path) VALUES(auth.uid(),target_path)
 ON CONFLICT(user_id) DO UPDATE SET storage_path=EXCLUDED.storage_path;
END $$;
REVOKE ALL ON FUNCTION public.profile_photo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_profile_photo(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.profile_photo(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_photo(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
