-- Apply only after all media has migrated. Does not delete any files or records.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.media WHERE storage_bucket <> 'sideproj-media') THEN
    RAISE EXCEPTION 'Local media remains. Finish migration before retiring local storage.';
  END IF;
END $$;
ALTER TABLE public.media ADD CONSTRAINT media_cloud_only CHECK(storage_bucket='sideproj-media');
DROP FUNCTION public.migrate_media(uuid,integer,text);
CREATE OR REPLACE FUNCTION private.verify_media_object() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE obj storage.objects;
BEGIN
  IF TG_OP='UPDATE'
    AND (NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
      OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    RAISE EXCEPTION 'Uploaded file references are immutable' USING ERRCODE='42501';
  END IF;
  IF split_part(NEW.storage_path,'/',1)<>NEW.created_by::text THEN
    RAISE EXCEPTION 'File path must belong to the record creator' USING ERRCODE='42501';
  END IF;
  SELECT * INTO obj FROM storage.objects WHERE bucket_id=NEW.storage_bucket AND name=NEW.storage_path;
  IF NOT FOUND OR (obj.metadata->>'size')::bigint IS DISTINCT FROM NEW.size_bytes
    OR (obj.metadata->>'mimetype') IS DISTINCT FROM NEW.mime_type THEN
    RAISE EXCEPTION 'Upload is missing or its metadata does not match' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF obj.owner_id IS DISTINCT FROM (SELECT auth.uid())::text AND NOT private.is_admin() THEN
      RAISE EXCEPTION 'This upload belongs to someone else' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;
