# Playwright browser tests

Start Docker Desktop and local Supabase (`npx supabase start`). Keep SUPABASE_URL and the local keys in .env.local. Keep the existing E2E_EMAIL and E2E_PASSWORD for a confirmed local email account with a completed profile.

Install Chromium once with `npm run test:e2e:install`.

- `npm run test:e2e:open`: interactive test UI.
- `npm run test:e2e`: headless run with terminal results.
- `npm run test:e2e:headed`: watch the live browser.
- `npm run test:e2e:debug`: pause and step through the test.
- `npm run test:e2e:report`: view the latest HTML results.

Playwright starts and stops its own app server on http://127.0.0.1:5174 using the same environment as the tests. No manual npm run dev is needed. An existing server on that port is rejected instead of reused. The configuration rejects non-local Supabase URLs.

The login/logout test uses real local authentication and checks the form, session persistence on reload, logout, cleared cookie, anonymous server session and reload after logout. Existing Node/database tests are unchanged. One worker is intentional until more tests and isolated test data are added.

Failed runs retain a screenshot and trace. These can include test credentials or tokens, so use disposable local accounts and keep artifacts private. Generated artifacts are ignored by Git. Legacy Cypress artifact ignore rules remain to protect existing local files.
