# Google sign-in with local Supabase

The existing SideProj button and server PKCE callback already support local Supabase. The local provider and exact app callback URLs are configured in config.toml. No SQL migration is needed.

## Google Cloud setup

Open https://console.cloud.google.com/auth/clients in the Google Cloud project used for SideProj. Create a separate OAuth client of type **Web application**, named **SideProj local development**.

- Authorized JavaScript origins: `http://localhost:5173` and `http://127.0.0.1:5173`.
- Authorized redirect URI: `http://127.0.0.1:54321/auth/v1/callback`.
- If the OAuth consent app is in Testing mode, add your Google account under Audience / Test users.

Keep the production client unchanged. Google redirects to Supabase's port 54321 callback; Supabase then redirects to the app's `/auth/google/callback` on port 5173.

## Local credentials

Create or edit `.env` beside package.json. The Supabase CLI reads this file; the app's `.env.local` is separate. Add:

```dotenv
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=your-client-secret
```

Both come from the Google OAuth client, not Supabase API keys. `.env` is ignored by Git. Do not put the secret in config.toml or a VITE\_ variable.

Keep `.env.local` pointing to local Supabase with its local API keys. Once Google credentials are filled in, start Docker Desktop and run:

```powershell
npx supabase stop
npx supabase start
npm run dev
```

Restart an existing app server instead of starting a second one. Open http://localhost:5173 and choose Continue with Google. Use the same hostname throughout the app session so the OAuth cookie can be checked. First-time local users should complete their profile. Accounts and roles are separate from production.

Google still requires internet access. Local email accounts remain the preferred choice for automated Playwright tests.

If you haven't supplied credentials yet, change only `[auth.external.google]`'s `enabled` to `false` to continue using local email login. Missing credentials with the provider enabled can prevent Supabase starting.

## Troubleshooting

- `redirect_uri_mismatch`: the Google client's redirect URI must exactly match `http://127.0.0.1:54321/auth/v1/callback`.
- Provider not enabled: restart local Supabase after editing configuration.
- Access denied for a test user: check Google Auth Platform's Audience settings.
- Returned to the site without logging in: check both port 5173 app callback URLs remain in `additional_redirect_urls` and restart the app before beginning a new login.
