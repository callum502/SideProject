BEGIN;
-- Preserve authored content while removing its owner on account deletion.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['locations','boulders','problems','media'] LOOP
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by DROP NOT NULL',t);
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',t,t||'_created_by_fkey');
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(created_by) REFERENCES public.profiles(id) ON DELETE SET NULL',t,t||'_created_by_fkey');
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION private.protect_record() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
 (NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT(NEW.created_by IS NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=OLD.created_by))) THEN
 RAISE EXCEPTION 'Record identity and creator cannot be changed' USING ERRCODE='42501'; END IF;
 IF (to_jsonb(NEW)->'location_id') IS DISTINCT FROM (to_jsonb(OLD)->'location_id') OR (to_jsonb(NEW)->'boulder_id') IS DISTINCT FROM (to_jsonb(OLD)->'boulder_id') THEN RAISE EXCEPTION 'Parent cannot be changed' USING ERRCODE='42501'; END IF;
 NEW.updated_at:=now();NEW.version:=OLD.version+1;RETURN NEW;
END $$;
-- Counter trigger must skip the ownerless records retained after deletion.
CREATE OR REPLACE FUNCTION private.enforce_post_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE maximum integer; changed integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by THEN RETURN NEW; END IF;
 IF TG_OP IN ('DELETE','UPDATE') AND OLD.created_by IS NOT NULL THEN
 UPDATE private.post_counts SET total=total-1 WHERE user_id=OLD.created_by AND kind=TG_TABLE_NAME;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') AND NEW.created_by IS NOT NULL THEN
 maximum:=CASE TG_TABLE_NAME WHEN 'locations' THEN 25 WHEN 'boulders' THEN 50 WHEN 'problems' THEN 250 END;
 INSERT INTO private.post_counts(user_id,kind,total) VALUES(NEW.created_by,TG_TABLE_NAME,1)
 ON CONFLICT(user_id,kind) DO UPDATE SET total=private.post_counts.total+1 WHERE private.post_counts.total<maximum;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=0 THEN RAISE EXCEPTION 'Post limit reached' USING ERRCODE='PZ001',DETAIL=TG_TABLE_NAME; END IF;
 END IF;RETURN NULL;
END $$;
-- Called only by the server admin client. Preserve contributed files, relinquish ownership.
CREATE FUNCTION public.prepare_account_deletion(target_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE storage.objects SET owner_id=NULL,owner=NULL WHERE owner_id=target_user::text OR owner=target_user;
END $$;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(uuid) TO service_role;
CREATE FUNCTION private.delete_account_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 DELETE FROM public.profiles WHERE id=OLD.id;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.delete_account_profile() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sideproj_delete_account BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION private.delete_account_profile();
-- Even an unexpired JWT cannot upload after its account has been deleted.
CREATE FUNCTION private.has_account() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid())
$$;
REVOKE ALL ON FUNCTION private.has_account() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.has_account() TO authenticated;
CREATE POLICY sideproj_active_account ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING(private.has_account()) WITH CHECK(private.has_account());
NOTIFY pgrst,'reload schema';
COMMIT;
