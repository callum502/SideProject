BEGIN;
CREATE TABLE private.account_details (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 height_cm integer NOT NULL CHECK(height_cm BETWEEN 100 AND 230),
 ape_index_inches integer CHECK(ape_index_inches BETWEEN -8 AND 8)
);
REVOKE ALL ON private.account_details FROM PUBLIC,anon,authenticated;
ALTER TABLE private.account_details ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.create_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE height text; ape text;
BEGIN
 INSERT INTO public.profiles(id,display_name) VALUES(NEW.id,coalesce(nullif(left(btrim(NEW.raw_user_meta_data->>'display_name'),120),''),'Climber'));
 INSERT INTO private.user_roles(user_id) VALUES(NEW.id);
 height:=NEW.raw_user_meta_data->>'height_cm'; ape:=NEW.raw_user_meta_data->>'ape_index_inches';
 IF height ~ '^[0-9]{3}$' AND height::integer BETWEEN 100 AND 230 AND (ape IS NULL OR ape ~ '^-?[0-8]$') THEN
  INSERT INTO private.account_details VALUES(NEW.id,height::integer,ape::integer);
 END IF;
 RETURN NEW;
END $$;
DROP FUNCTION public.current_account();
CREATE FUNCTION public.current_account() RETURNS TABLE(id uuid,display_name text,role text,height_cm integer,ape_index_inches integer,profile_complete boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.id,p.display_name,r.role,d.height_cm,d.ape_index_inches,d.user_id IS NOT NULL
 FROM public.profiles p JOIN private.user_roles r ON r.user_id=p.id LEFT JOIN private.account_details d ON d.user_id=p.id WHERE p.id=auth.uid()
$$;
REVOKE ALL ON FUNCTION public.current_account() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_account() TO authenticated;
CREATE FUNCTION public.complete_profile(display_name text,height_cm integer,ape_index_inches integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in first' USING ERRCODE='42501'; END IF;
 IF display_name IS NULL OR length(btrim(display_name)) NOT BETWEEN 1 AND 120 OR height_cm IS NULL OR height_cm NOT BETWEEN 100 AND 230 OR (ape_index_inches IS NOT NULL AND ape_index_inches NOT BETWEEN -8 AND 8) THEN RAISE EXCEPTION 'Invalid profile details' USING ERRCODE='23514'; END IF;
 UPDATE public.profiles SET display_name=btrim(complete_profile.display_name) WHERE id=auth.uid();
 INSERT INTO private.account_details VALUES(auth.uid(),height_cm,ape_index_inches) ON CONFLICT(user_id) DO UPDATE SET height_cm=EXCLUDED.height_cm,ape_index_inches=EXCLUDED.ape_index_inches;
END $$;
REVOKE ALL ON FUNCTION public.complete_profile(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_profile(text,integer,integer) TO authenticated;
COMMIT;
