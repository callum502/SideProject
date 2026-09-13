BEGIN;
-- Align the stored profile rules with the current feet/inches form.
-- Keep existing accounts, measurements, roles and signup triggers intact.
ALTER TABLE private.account_details DROP CONSTRAINT IF EXISTS account_details_height_cm_check;
ALTER TABLE private.account_details ADD CONSTRAINT account_details_height_cm_check CHECK(height_cm BETWEEN 30 AND 333);
CREATE OR REPLACE FUNCTION public.complete_profile(display_name text,height_cm integer,ape_index_inches integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in first' USING ERRCODE='42501'; END IF;
 IF display_name IS NULL OR length(btrim(display_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid display name' USING ERRCODE='23514'; END IF;
 IF height_cm IS NULL OR height_cm NOT BETWEEN 30 AND 333 THEN RAISE EXCEPTION 'Invalid height' USING ERRCODE='23514'; END IF;
 IF ape_index_inches IS NOT NULL AND ape_index_inches NOT BETWEEN -8 AND 8 THEN RAISE EXCEPTION 'Invalid ape index' USING ERRCODE='23514'; END IF;
 UPDATE public.profiles SET display_name=btrim(complete_profile.display_name) WHERE id=auth.uid();
 INSERT INTO private.account_details(user_id,height_cm,ape_index_inches)
 VALUES(auth.uid(),complete_profile.height_cm,complete_profile.ape_index_inches)
 ON CONFLICT(user_id) DO UPDATE SET height_cm=EXCLUDED.height_cm,ape_index_inches=EXCLUDED.ape_index_inches;
END $$;
REVOKE ALL ON FUNCTION public.complete_profile(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_profile(text,integer,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
