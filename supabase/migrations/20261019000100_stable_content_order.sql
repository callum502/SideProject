BEGIN;
-- Rows saved together share created_at (now() is the transaction's start time), and read_content broke those
-- ties by random UUID, so photos and videos uploaded together came back shuffled. save_content inserts rows in
-- the order the app sends them, so an identity column records the chosen order for read_content to use.
-- Existing rows are numbered in no particular order; created_at still orders them first.
ALTER TABLE public.locations ADD COLUMN insert_order bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.boulders ADD COLUMN insert_order bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.problems ADD COLUMN insert_order bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.media ADD COLUMN insert_order bigint GENERATED ALWAYS AS IDENTITY;

CREATE OR REPLACE FUNCTION public.read_content() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT jsonb_build_object(
'locations', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.insert_order) FROM public.locations t), '[]'::jsonb),
'boulders', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.insert_order) FROM public.boulders t), '[]'::jsonb),
'problems', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.insert_order) FROM public.problems t), '[]'::jsonb),
'media', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.insert_order) FROM public.media t), '[]'::jsonb),
'problem_media', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.problem_id, t.media_id) FROM public.problem_media t), '[]'::jsonb), 'profiles', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'display_name',display_name)) FROM public.profiles), '[]'::jsonb))
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
