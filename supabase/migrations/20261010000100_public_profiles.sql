BEGIN;
-- Public profile projection: never expose email addresses, roles or authentication data.
CREATE FUNCTION public.read_public_profile(target_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p.id,'name',p.display_name,'height',d.height_cm,'apeIndex',d.ape_index_inches,
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'entry_id',l.entry_id,'problem_id',l.problem_id,
   'location_id',l.location_id,'boulder_id',l.boulder_id,
   'problem_name',coalesce(pr.name,l.problem_name),'grade',coalesce(pr.grade,l.grade),
   'boulder_name',coalesce(b.name,l.boulder_name),'location_name',coalesce(loc.name,l.location_name),
   'logged_at',l.logged_at
  ) ORDER BY l.logged_at DESC,l.entry_id) FROM private.problem_logs l
   LEFT JOIN public.problems pr ON pr.id=l.problem_id
   LEFT JOIN public.boulders b ON b.id=pr.boulder_id
   LEFT JOIN public.locations loc ON loc.id=b.location_id
   WHERE l.user_id=p.id),'[]'::jsonb)
 ) FROM public.profiles p LEFT JOIN private.account_details d ON d.user_id=p.id WHERE p.id=target_user
$$;
REVOKE ALL ON FUNCTION public.read_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_public_profile(uuid) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
