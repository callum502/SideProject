BEGIN;
-- Removing a photo or video from the guide now deletes its file too, so it stops counting towards the uploader's
-- 10 GB allowance (the storage quota trigger subtracts it) and its public link stops working. The server deletes
-- files through the Storage API with the user's own token after the guide save (storage.mjs remove), never by
-- deleting storage.objects rows directly, which would leave the bytes behind.
-- A file may be deleted only by its owner or an admin, and only once nothing uses it: no media record (a file
-- uploaded for an upload still in progress has none yet, but the server only deletes files of removed records)
-- and no profile photo, which may be the same file as a guide photo.
CREATE FUNCTION private.media_file_in_use(path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.media WHERE storage_bucket='sideproj-media' AND storage_path=path)
     OR EXISTS(SELECT 1 FROM private.profile_photos WHERE storage_path=path)
$$;
REVOKE ALL ON FUNCTION private.media_file_in_use(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.media_file_in_use(text) TO authenticated;

CREATE POLICY sideproj_remove_unused ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='sideproj-media' AND (owner_id=(SELECT auth.uid())::text OR (SELECT private.is_admin())) AND NOT private.media_file_in_use(name));
COMMIT;
