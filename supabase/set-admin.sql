-- Replace you@example.com with your confirmed administrator email before running.
-- Run in the Supabase SQL Editor AFTER creating and confirming your account.
-- This cannot be run by a contributor through the app.
DO $$
DECLARE account_id uuid;
BEGIN
  SELECT id INTO account_id FROM auth.users
  WHERE lower(email) = 'you@example.com' AND email_confirmed_at IS NOT NULL;
  IF account_id IS NULL THEN
    RAISE EXCEPTION 'Create and confirm the you@example.com account first.';
  END IF;
  UPDATE private.user_roles SET role = 'admin' WHERE user_id = account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account profile is missing.'; END IF;
END $$;

SELECT p.id, p.display_name, r.role
FROM public.profiles p JOIN private.user_roles r ON r.user_id = p.id
JOIN auth.users u ON u.id = p.id WHERE lower(u.email) = 'you@example.com';
