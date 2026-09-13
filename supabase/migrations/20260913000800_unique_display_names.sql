BEGIN;
CREATE UNIQUE INDEX profiles_display_name_unique ON public.profiles(lower(btrim(display_name)));
CREATE FUNCTION public.display_name_available(candidate text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT candidate IS NOT NULL AND length(btrim(candidate)) BETWEEN 1 AND 120 AND NOT EXISTS(
 SELECT 1 FROM public.profiles WHERE lower(btrim(display_name))=lower(btrim(candidate)) AND id IS DISTINCT FROM auth.uid())
$$;
REVOKE ALL ON FUNCTION public.display_name_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.display_name_available(text) TO anon,authenticated;
CREATE OR REPLACE FUNCTION private.create_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE height text; ape text; chosen_name text;
BEGIN
 -- OAuth users choose a display name during profile completion. Do not claim the provider's name.
 chosen_name:=CASE WHEN NEW.raw_app_meta_data->>'provider'='email' THEN nullif(left(btrim(NEW.raw_user_meta_data->>'display_name'),120),'') ELSE NULL END;
 IF chosen_name IS NULL THEN
  LOOP
   chosen_name:='Climber-' || gen_random_uuid()::text;
   BEGIN
    INSERT INTO public.profiles(id,display_name) VALUES(NEW.id,chosen_name);
    EXIT;
   EXCEPTION WHEN unique_violation THEN NULL;
   END;
  END LOOP;
 ELSE
  INSERT INTO public.profiles(id,display_name) VALUES(NEW.id,chosen_name);
 END IF;
 INSERT INTO private.user_roles(user_id) VALUES(NEW.id);
 height:=NEW.raw_user_meta_data->>'height_cm'; ape:=NEW.raw_user_meta_data->>'ape_index_inches';
 IF NEW.raw_app_meta_data->>'provider'='email' AND height ~ '^[0-9]{2,3}$' AND height::integer BETWEEN 30 AND 333 AND (ape IS NULL OR ape ~ '^-?[0-8]$') THEN
  INSERT INTO private.account_details VALUES(NEW.id,height::integer,ape::integer);
 END IF;
 RETURN NEW;
END $$;
COMMIT;
