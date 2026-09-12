-- Run after the content API migration. Existing local references remain readable.
BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('sideproj-media','sideproj-media',true,104857600,ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']);

CREATE POLICY sideproj_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='sideproj-media'
  AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-f0-9-]+\.(png|jpg|webp|mp4|webm|mov)$'
  AND (split_part(name,'/',1)=(SELECT auth.uid())::text OR (SELECT private.is_admin())));
CREATE POLICY sideproj_inspect ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='sideproj-media' AND (owner_id=(SELECT auth.uid())::text OR (SELECT private.is_admin())));
-- No client UPDATE/DELETE policies: objects are immutable, and cannot be removed
-- while migration or a content save is attaching them. Cleanup is an admin task.

ALTER TABLE public.media DROP CONSTRAINT media_local_reference;
ALTER TABLE public.media ADD CONSTRAINT media_storage_reference CHECK (
  ((storage_bucket='local' AND storage_path ~ '^[a-f0-9-]+\.(png|jpg|webp|mp4|webm|mov)$')
    OR (storage_bucket='sideproj-media' AND storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-f0-9-]+\.(png|jpg|webp|mp4|webm|mov)$'))
  AND mime_type=CASE substring(storage_path from '\.([^.]+)$')
    WHEN 'png' THEN 'image/png' WHEN 'jpg' THEN 'image/jpeg' WHEN 'webp' THEN 'image/webp'
    WHEN 'mp4' THEN 'video/mp4' WHEN 'webm' THEN 'video/webm' WHEN 'mov' THEN 'video/quicktime' END
);

CREATE FUNCTION private.verify_media_object() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE obj storage.objects;
BEGIN
  IF TG_OP='UPDATE' AND OLD.storage_bucket='sideproj-media'
    AND (NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
      OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    RAISE EXCEPTION 'Uploaded file references are immutable' USING ERRCODE='42501';
  END IF;
  IF NEW.storage_bucket='local' THEN RETURN NEW; END IF;
  IF split_part(NEW.storage_path,'/',1)<>NEW.created_by::text THEN
    RAISE EXCEPTION 'File path must belong to the record creator' USING ERRCODE='42501';
  END IF;
  SELECT * INTO obj FROM storage.objects WHERE bucket_id=NEW.storage_bucket AND name=NEW.storage_path;
  IF NOT FOUND OR (obj.metadata->>'size')::bigint IS DISTINCT FROM NEW.size_bytes
    OR (obj.metadata->>'mimetype') IS DISTINCT FROM NEW.mime_type THEN
    RAISE EXCEPTION 'Upload is missing or its metadata does not match' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' OR OLD.storage_bucket='local' THEN
    IF obj.owner_id IS DISTINCT FROM (SELECT auth.uid())::text AND NOT private.is_admin() THEN
      RAISE EXCEPTION 'This upload belongs to someone else' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.verify_media_object() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER verify_media_object BEFORE INSERT OR UPDATE ON public.media
FOR EACH ROW EXECUTE FUNCTION private.verify_media_object();

CREATE FUNCTION public.migrate_media(media_id uuid, expected_version integer, target_path text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE affected integer;
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  UPDATE public.media SET storage_bucket='sideproj-media',storage_path=target_path
  WHERE id=media_id AND version=expected_version AND storage_bucket='local'
    AND target_path=created_by::text || '/' || storage_path;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Media changed during migration; refresh and retry' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.migrate_media(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_media(uuid,integer,text) TO authenticated;
COMMIT;
