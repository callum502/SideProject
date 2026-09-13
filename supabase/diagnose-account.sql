-- Read-only account diagnostics. Run in Supabase SQL Editor.
-- No passwords, email addresses, tokens or profile measurements are returned.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS return_type,
       p.prosecdef AS security_definer,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('current_account','complete_profile','display_name_available');
SELECT pg_get_functiondef(p.oid) AS current_account_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='current_account';
SELECT to_regclass('public.profiles') AS profiles,
       to_regclass('private.user_roles') AS roles,
       to_regclass('private.account_details') AS account_details;
