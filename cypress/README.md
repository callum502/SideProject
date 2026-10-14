# Browser tests

These tests exercise the real app and local Supabase, without mocked login responses.

One-time setup: run `npx cypress install` to download the desktop runner. Cypress 15 is pinned for compatibility with this project's Node 20 environment.

1. Start Docker Desktop and run `npx supabase start`.
2. Point `.env.local` at local Supabase. Create and confirm a local email account through SideProj, completing its display name and height.
3. Add `E2E_EMAIL` and `E2E_PASSWORD` to the ignored `.env.local`, using that account. Never use production credentials.
4. Restart the app with `npm run dev` so its configuration matches the test configuration.
5. In another terminal, run `npm run test:e2e:open`. Choose E2E Testing, a browser, then `login-logout.cy.js`.

For a terminal pass/fail summary, run `npm run test:e2e`. The server must already be running. The default URL is http://localhost:5173. Config rejects non-local site and Supabase URLs; it cannot inspect the environment of an already-running server, so restart the server after changing environments.

The test logs in using the visible form, checks persistence after reload, logs out through the account menu, and checks the cookie and server session are gone. It does not create or delete content. Password typing is hidden from Cypress's command log. Use only disposable local credentials; debugging tools can still inspect browser network traffic.
