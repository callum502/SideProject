BEGIN;
-- Count media records, not problem attachments. Existing over-limit locations
-- retain their files, but cannot add more until their count is below 50.
LOCK TABLE public.locations, public.boulders, public.media IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE private.location_media_counts (
 location_id uuid PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
 total bigint NOT NULL CHECK (total >= 0)
);
ALTER TABLE private.location_media_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.location_media_counts FROM PUBLIC, anon, authenticated;
INSERT INTO private.location_media_counts(location_id,total)
 SELECT coalesce(m.location_id,b.location_id),count(*)
 FROM public.media m LEFT JOIN public.boulders b ON b.id=m.boulder_id
 GROUP BY coalesce(m.location_id,b.location_id);

CREATE FUNCTION private.enforce_location_media_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid; changed integer;
BEGIN
 IF TG_OP='DELETE' THEN
  target:=coalesce(OLD.location_id,(SELECT location_id FROM public.boulders WHERE id=OLD.boulder_id));
  UPDATE private.location_media_counts SET total=total-1 WHERE location_id=target;
 ELSE
  target:=coalesce(NEW.location_id,(SELECT location_id FROM public.boulders WHERE id=NEW.boulder_id));
  INSERT INTO private.location_media_counts(location_id,total) VALUES(target,1)
  ON CONFLICT(location_id) DO UPDATE SET total=private.location_media_counts.total+1
   WHERE private.location_media_counts.total<50;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN
   RAISE EXCEPTION 'This location has a maximum of 50 photos and videos combined, including parking photos. Remove an existing photo or video before adding more.' USING ERRCODE='PZ002';
  END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.enforce_location_media_limit() FROM PUBLIC,anon,authenticated;
-- Existing protect_record triggers make media/boulder parent references immutable.
CREATE TRIGGER enforce_location_media_limit AFTER INSERT OR DELETE ON public.media
 FOR EACH ROW EXECUTE FUNCTION private.enforce_location_media_limit();
NOTIFY pgrst,'reload schema';
COMMIT;
