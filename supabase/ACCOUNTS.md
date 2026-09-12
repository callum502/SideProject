# Individual accounts setup

The app now uses Supabase Auth for email/password accounts and reads trusted roles from PostgreSQL. Content uses PostgreSQL and uploaded files use Supabase Storage.

## 1. Apply the account migration

In your project's SQL Editor, create a new query, paste all of `migrations/20260909000200_account_access.sql`, and click Run once. The initial schema must already be installed.

## 2. Set up confirmation and recovery emails

In Authentication, ensure Email sign-in, new user signups and **Confirm email** are enabled. Set the minimum password length to 12 to match this app.

Open the email templates (Authentication → Email → Templates; some dashboard layouts list Email Templates directly). This app accepts codes rather than redirecting email links:

- In **Confirm signup**, use a body containing `<h2>Confirm your SideProj account</h2><p>Your confirmation code is: {{ .Token }}</p>`.
- In **Reset password**, use `<h2>Reset your SideProj password</h2><p>Your recovery code is: {{ .Token }}</p>`.

Save both templates. Keep the `{{ .Token }}` placeholder exactly as shown. Users paste the code into SideProj; no redirect URL is needed for these flows. Leave codes and their expiration under Supabase's control.

Supabase's default email sender is restricted to project-team addresses and has a low sending limit. To invite the wider community, configure custom SMTP in Supabase first (for example, an email provider with a verified sending domain). Provider charges and domain costs are separate; check your selected provider's plan. See [Supabase SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp).

## 3. Start the app and create your account

Copy `.env.example` to `.env.local` and fill in your project URL and publishable key. Existing installations can keep their configured `.env.local`. This file is ignored by Git. No secret/service-role key is used.

From the project folder run `npm run dev` (restart an already running server). Open http://127.0.0.1:5173, choose **Create an account**, and use **you@example.com** with your own password. Enter the emailed confirmation code. Use your own email address in place of this example.

## 4. Grant your admin role

Replace `you@example.com` in `set-admin.sql` with your confirmed email, then run the query in the SQL Editor. It only grants the role after that email is confirmed. Then log in to SideProj. You should see **admin** next to your name.

New contributors can add boulders/problems anywhere, but can edit only their own submissions. Display names do not control permissions.

## Quick checks

- Guest: can browse but cannot add/edit content.
- New contributor: can add to your location but cannot edit it.
- Two people with the same display name cannot edit each other's submissions.
- Admin: can edit any submission.
- Forgot password: sends a code; entering it with a new password enables login with the new password.
- Logout: returns to the login screen and invalidates the app session.

Passwords go to Supabase over HTTPS. Browser sessions use an HttpOnly, SameSite cookie; Supabase tokens stay in server memory. Sessions refresh while in use, last at most 24 hours, and end on server restart. Permissions are re-read for authenticated API requests, so changing a database role takes effect without creating a new account. This server remains bound to localhost; public deployment is a separate step.
