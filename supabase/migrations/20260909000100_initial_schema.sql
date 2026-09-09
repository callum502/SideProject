-- SideProj initial schema. Apply once to a fresh Supabase development project.
-- Existing app remains JSON-backed until its backend is migrated.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Roles cannot be assigned through user-editable signup metadata.
CREATE TABLE private.user_roles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'contributor' CHECK (role IN ('admin', 'contributor'))
);
REVOKE ALL ON private.user_roles FROM PUBLIC, anon, authenticated;
ALTER TABLE private.user_roles ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION private.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM private.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
) $$;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

CREATE FUNCTION private.create_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id, display_name)
  VALUES (NEW.id, coalesce(nullif(left(btrim(NEW.raw_user_meta_data->>'display_name'),120), ''), 'Climber'));
  INSERT INTO private.user_roles(user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.create_profile() FROM PUBLIC;
CREATE TRIGGER sideproj_create_profile AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.create_profile();

-- Also accommodate accounts created before applying this migration.
INSERT INTO public.profiles(id, display_name)
SELECT id, coalesce(nullif(left(btrim(raw_user_meta_data->>'display_name'),120), ''), 'Climber') FROM auth.users;
INSERT INTO private.user_roles(user_id) SELECT id FROM public.profiles;

CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  region text NOT NULL DEFAULT '' CHECK (length(region) <= 120),
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  approach_notes text NOT NULL DEFAULT '' CHECK (length(approach_notes) <= 10000),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE public.boulders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  finding_notes text NOT NULL DEFAULT '' CHECK (length(finding_notes) <= 10000),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE public.problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boulder_id uuid NOT NULL REFERENCES public.boulders(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  grade text NOT NULL CHECK (length(btrim(grade)) BETWEEN 1 AND 40),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 10000),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id, boulder_id)
);
CREATE TABLE public.media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boulder_id uuid NOT NULL REFERENCES public.boulders(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  storage_bucket text NOT NULL CHECK (length(btrim(storage_bucket)) > 0),
  storage_path text NOT NULL CHECK (length(btrim(storage_path)) > 0),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  annotations jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(annotations) = 'array'),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (storage_bucket, storage_path),
  UNIQUE (id, boulder_id),
  CHECK ((kind = 'image' AND mime_type IN ('image/jpeg','image/png','image/webp') AND size_bytes <= 8388608)
    OR (kind = 'video' AND mime_type IN ('video/mp4','video/webm','video/quicktime') AND size_bytes <= 104857600)),
  CHECK (kind = 'image' OR annotations = '[]'::jsonb)
);
CREATE TABLE public.problem_media (
  problem_id uuid NOT NULL,
  media_id uuid NOT NULL,
  boulder_id uuid NOT NULL,
  PRIMARY KEY (problem_id, media_id),
  FOREIGN KEY (problem_id, boulder_id) REFERENCES public.problems(id, boulder_id) ON DELETE CASCADE,
  FOREIGN KEY (media_id, boulder_id) REFERENCES public.media(id, boulder_id) ON DELETE CASCADE
);

CREATE INDEX boulders_location_idx ON public.boulders(location_id);
CREATE INDEX problems_boulder_idx ON public.problems(boulder_id);
CREATE INDEX media_boulder_idx ON public.media(boulder_id);
CREATE INDEX problem_media_media_idx ON public.problem_media(media_id, boulder_id);
CREATE INDEX locations_creator_idx ON public.locations(created_by);
CREATE INDEX boulders_creator_idx ON public.boulders(created_by);
CREATE INDEX problems_creator_idx ON public.problems(created_by);
CREATE INDEX media_creator_idx ON public.media(created_by);
CREATE INDEX locations_name_idx ON public.locations(lower(name));

-- Keep ownership and parentage stable. Moving records requires a deliberate future migration/workflow.
CREATE FUNCTION private.protect_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Record identity and creator cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW)->'location_id') IS DISTINCT FROM (to_jsonb(OLD)->'location_id')
     OR (to_jsonb(NEW)->'boulder_id') IS DISTINCT FROM (to_jsonb(OLD)->'boulder_id') THEN
    RAISE EXCEPTION 'Parent cannot be changed' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_record() FROM PUBLIC;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;
CREATE POLICY profiles_read ON public.profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY profiles_edit ON public.profiles FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT private.is_admin()))
WITH CHECK (id = (SELECT auth.uid()) OR (SELECT private.is_admin()));

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['locations','boulders','problems','media'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', tbl);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
    EXECUTE format('CREATE POLICY read_public ON public.%I FOR SELECT TO anon, authenticated USING (true)', tbl);
    EXECUTE format('CREATE POLICY insert_own ON public.%I FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid()))', tbl);
    EXECUTE format('CREATE POLICY update_own ON public.%I FOR UPDATE TO authenticated USING (created_by = (SELECT auth.uid()) OR (SELECT private.is_admin())) WITH CHECK (created_by = (SELECT auth.uid()) OR (SELECT private.is_admin()))', tbl);
    EXECUTE format('CREATE POLICY delete_own ON public.%I FOR DELETE TO authenticated USING (created_by = (SELECT auth.uid()) OR (SELECT private.is_admin()))', tbl);
    EXECUTE format('CREATE TRIGGER protect_record BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.protect_record()', tbl);
  END LOOP;
END;
$$;

ALTER TABLE public.problem_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.problem_media FROM anon, authenticated;
GRANT SELECT ON public.problem_media TO anon, authenticated;
GRANT INSERT, DELETE ON public.problem_media TO authenticated;
CREATE POLICY attachments_read ON public.problem_media FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY attachments_add ON public.problem_media FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.problems p WHERE p.id = problem_id AND (p.created_by = (SELECT auth.uid()) OR (SELECT private.is_admin())))
);
CREATE POLICY attachments_remove ON public.problem_media FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.problems p WHERE p.id = problem_id AND (p.created_by = (SELECT auth.uid()) OR (SELECT private.is_admin())))
);

COMMIT;
