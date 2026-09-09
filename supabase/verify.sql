-- Read-only verification after applying the migration.
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE (schemaname = 'public' AND tablename IN
  ('profiles', 'locations', 'boulders', 'problems', 'media', 'problem_media'))
  OR (schemaname = 'private' AND tablename = 'user_roles')
ORDER BY schemaname, tablename;

SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN
  ('profiles', 'locations', 'boulders', 'problems', 'media', 'problem_media')
ORDER BY tablename, policyname;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('public.locations'::regclass, 'public.boulders'::regclass,
 'public.problems'::regclass, 'public.media'::regclass, 'public.problem_media'::regclass)
ORDER BY table_name, conname;
