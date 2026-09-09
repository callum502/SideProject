BEGIN;
-- Returns only the caller's identity and trusted role; accepts no user-selected ID.
CREATE FUNCTION public.current_account()
RETURNS TABLE (id uuid, display_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.display_name, r.role
  FROM public.profiles p JOIN private.user_roles r ON r.user_id = p.id
  WHERE p.id = (SELECT auth.uid())
$$;
REVOKE ALL ON FUNCTION public.current_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_account() TO authenticated;
COMMIT;
