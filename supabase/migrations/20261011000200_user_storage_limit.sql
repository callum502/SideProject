BEGIN;
-- Decimal GB: 10 GB = 10,000,000,000 bytes. Count stored objects, including
-- unattached uploads and avatars. Never delete Storage metadata to free space:
-- remove files through the Storage API so the underlying bytes are also removed.
LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE private.user_storage_usage (
 user_id uuid PRIMARY KEY,
 used_bytes bigint NOT NULL CHECK (used_bytes >= 0)
);
ALTER TABLE private.user_storage_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.user_storage_usage FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.storage_quota_owner(bucket text, path text) RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN bucket='sideproj-media' AND path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
 THEN split_part(path,'/',1)::uuid END
$$;
CREATE FUNCTION private.storage_quota_bytes(meta jsonb) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 -- Storage's permission probe may have contentLength instead of size.
 -- Unknown-size objects conservatively count as the bucket's 100 MiB maximum.
 SELECT greatest(0,coalesce((meta->>'size')::bigint,(meta->>'contentLength')::bigint,104857600))
$$;
INSERT INTO private.user_storage_usage(user_id,used_bytes)
 SELECT private.storage_quota_owner(bucket_id,name),sum(private.storage_quota_bytes(metadata))
 FROM storage.objects WHERE private.storage_quota_owner(bucket_id,name) IS NOT NULL
 GROUP BY private.storage_quota_owner(bucket_id,name);

CREATE FUNCTION private.adjust_storage_quota(target uuid, delta bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
 IF target IS NULL OR delta=0 THEN RETURN; END IF;
 IF delta>10000000000 THEN RAISE EXCEPTION 'This upload would exceed your 10 GB upload allowance.' USING ERRCODE='PZ003'; END IF;
 INSERT INTO private.user_storage_usage(user_id,used_bytes) VALUES(target,greatest(delta,0))
 ON CONFLICT(user_id) DO UPDATE SET used_bytes=private.user_storage_usage.used_bytes+delta
 WHERE delta<0 OR private.user_storage_usage.used_bytes+delta<=10000000000;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=0 THEN RAISE EXCEPTION 'This upload would exceed your 10 GB upload allowance.' USING ERRCODE='PZ003'; END IF;
END $$;

CREATE FUNCTION private.enforce_storage_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_user uuid; new_user uuid; old_bytes bigint:=0; new_bytes bigint:=0;
BEGIN
 IF TG_OP<>'INSERT' THEN
  old_user:=private.storage_quota_owner(OLD.bucket_id,OLD.name);
  old_bytes:=private.storage_quota_bytes(OLD.metadata);
 END IF;
 IF TG_OP<>'DELETE' THEN
  new_user:=private.storage_quota_owner(NEW.bucket_id,NEW.name);
  new_bytes:=private.storage_quota_bytes(NEW.metadata);
 END IF;
 IF old_user IS NOT DISTINCT FROM new_user THEN
  PERFORM private.adjust_storage_quota(new_user,new_bytes-old_bytes);
 ELSE
  PERFORM private.adjust_storage_quota(old_user,-old_bytes);
  PERFORM private.adjust_storage_quota(new_user,new_bytes);
 END IF;
 RETURN NULL;
END $$;
-- AFTER avoids double counting INSERT ... ON CONFLICT DO UPDATE. Atomic row
-- updates serialize simultaneous uploads for the same account. Permission
-- probes roll back their counters with their transaction; final writes recheck.
CREATE TRIGGER sideproj_storage_quota AFTER INSERT OR UPDATE OR DELETE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION private.enforce_storage_quota();
REVOKE ALL ON FUNCTION private.storage_quota_owner(text,text),private.storage_quota_bytes(jsonb),private.adjust_storage_quota(uuid,bigint),private.enforce_storage_quota() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.my_storage_usage() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in first' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('usedBytes',coalesce((SELECT used_bytes FROM private.user_storage_usage WHERE user_id=auth.uid()),0),'limitBytes',10000000000);
END $$;
REVOKE ALL ON FUNCTION public.my_storage_usage() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_storage_usage() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
