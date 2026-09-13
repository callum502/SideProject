BEGIN;
ALTER TABLE private.account_details DROP CONSTRAINT account_details_height_cm_check;
ALTER TABLE private.account_details ADD CONSTRAINT account_details_height_cm_check CHECK(height_cm BETWEEN 30 AND 333);
CREATE OR REPLACE FUNCTION private.create_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE height text; ape text;
BEGIN
 INSERT INTO public.profiles(id,display_name) VALUES(NEW.id,coalesce(nullif(left(btrim(NEW.raw_user_meta_data->>'display_name'),120),''),'Climber'));
 INSERT INTO private.user_roles(user_id) VALUES(NEW.id);
 height:=NEW.raw_user_meta_data->>'height_cm'; ape:=NEW.raw_user_meta_data->>'ape_index_inches';
 IF height ~ '^[0-9]{2,3}$' AND height::integer BETWEEN 30 AND 333 AND (ape IS NULL OR ape ~ '^-?[0-8]$') THEN
  INSERT INTO private.account_details VALUES(NEW.id,height::integer,ape::integer);
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.complete_profile(display_name text,height_cm integer,ape_index_inches integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in first' USING ERRCODE='42501'; END IF;
 IF display_name IS NULL OR length(btrim(display_name)) NOT BETWEEN 1 AND 120 OR height_cm IS NULL OR height_cm NOT BETWEEN 30 AND 333 OR (ape_index_inches IS NOT NULL AND ape_index_inches NOT BETWEEN -8 AND 8) THEN RAISE EXCEPTION 'Invalid profile details' USING ERRCODE='23514'; END IF;
 UPDATE public.profiles SET display_name=btrim(complete_profile.display_name) WHERE id=auth.uid();
 INSERT INTO private.account_details VALUES(auth.uid(),height_cm,ape_index_inches) ON CONFLICT(user_id) DO UPDATE SET height_cm=EXCLUDED.height_cm,ape_index_inches=EXCLUDED.ape_index_inches;
END $$;
REVOKE ALL ON FUNCTION public.complete_profile(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_profile(text,integer,integer) TO authenticated;
COMMIT;
