BEGIN;
-- Atomic counters prevent concurrent inserts from exceeding a user's limit.
LOCK TABLE public.locations,public.boulders,public.problems IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE private.post_counts (
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('locations','boulders','problems')),
 total bigint NOT NULL CHECK(total>=0),
 PRIMARY KEY(user_id,kind)
);
REVOKE ALL ON private.post_counts FROM PUBLIC,anon,authenticated;
ALTER TABLE private.post_counts ENABLE ROW LEVEL SECURITY;
INSERT INTO private.post_counts SELECT created_by,'locations',count(*) FROM public.locations GROUP BY created_by;
INSERT INTO private.post_counts SELECT created_by,'boulders',count(*) FROM public.boulders GROUP BY created_by;
INSERT INTO private.post_counts SELECT created_by,'problems',count(*) FROM public.problems GROUP BY created_by;
CREATE FUNCTION private.enforce_post_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE maximum integer; changed integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by THEN RETURN NEW; END IF;
 IF TG_OP IN ('DELETE','UPDATE') THEN
  UPDATE private.post_counts SET total=total-1 WHERE user_id=OLD.created_by AND kind=TG_TABLE_NAME;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  maximum:=CASE TG_TABLE_NAME WHEN 'locations' THEN 25 WHEN 'boulders' THEN 50 WHEN 'problems' THEN 250 END;
  INSERT INTO private.post_counts(user_id,kind,total) VALUES(NEW.created_by,TG_TABLE_NAME,1)
  ON CONFLICT(user_id,kind) DO UPDATE SET total=private.post_counts.total+1 WHERE private.post_counts.total<maximum;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RAISE EXCEPTION 'You already have the maximum % %. Remove one before creating another.',maximum,TG_TABLE_NAME USING ERRCODE='PZ001',DETAIL=TG_TABLE_NAME; END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.enforce_post_limit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER enforce_post_limit AFTER INSERT OR DELETE OR UPDATE OF created_by ON public.locations FOR EACH ROW EXECUTE FUNCTION private.enforce_post_limit();
CREATE TRIGGER enforce_post_limit AFTER INSERT OR DELETE OR UPDATE OF created_by ON public.boulders FOR EACH ROW EXECUTE FUNCTION private.enforce_post_limit();
CREATE TRIGGER enforce_post_limit AFTER INSERT OR DELETE OR UPDATE OF created_by ON public.problems FOR EACH ROW EXECUTE FUNCTION private.enforce_post_limit();
COMMIT;
