BEGIN;
CREATE TABLE private.problem_logs (
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 problem_id uuid REFERENCES public.problems(id) ON DELETE SET NULL,
 location_id uuid NOT NULL,
 boulder_id uuid NOT NULL,
 problem_name text NOT NULL,
 grade text NOT NULL,
 boulder_name text NOT NULL,
 location_name text NOT NULL,
 logged_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,problem_id)
);
ALTER TABLE private.problem_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.problem_logs FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.read_logbook() RETURNS SETOF private.problem_logs
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT * FROM private.problem_logs WHERE user_id=auth.uid() ORDER BY logged_at DESC,entry_id
$$;
CREATE FUNCTION public.set_problem_log(target_problem uuid,completed boolean) RETURNS SETOF private.problem_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in first'; END IF;
 IF completed IS NULL THEN RAISE EXCEPTION 'Completion is required'; END IF;
 IF completed THEN
  INSERT INTO private.problem_logs(user_id,problem_id,location_id,boulder_id,problem_name,grade,boulder_name,location_name)
  SELECT auth.uid(),p.id,l.id,b.id,p.name,p.grade,b.name,l.name
  FROM public.problems p JOIN public.boulders b ON b.id=p.boulder_id JOIN public.locations l ON l.id=b.location_id WHERE p.id=target_problem
  ON CONFLICT(user_id,problem_id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM private.problem_logs WHERE user_id=auth.uid() AND problem_id=target_problem) THEN RAISE EXCEPTION 'Problem not found'; END IF;
 ELSE
  DELETE FROM private.problem_logs WHERE user_id=auth.uid() AND (problem_id=target_problem OR (problem_id IS NULL AND entry_id=target_problem));
 END IF;
 RETURN QUERY SELECT * FROM public.read_logbook();
END $$;
REVOKE ALL ON FUNCTION public.read_logbook() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_problem_log(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_logbook() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_problem_log(uuid,boolean) TO authenticated;
COMMIT;
