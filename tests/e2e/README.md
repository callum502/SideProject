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

## CRUD tests

`location-crud.spec.ts`, `boulder-crud.spec.ts`, and `problem-crud.spec.ts` each have three report steps: Create, Edit and Delete. They use `testHelpers.ts` for login, navigation, creation, editing, deletion and cleanup. They use the same E2E_EMAIL/E2E_PASSWORD account and run one test at a time with the default configuration. Do not override workers or launch simultaneous runs against the same database yet.

Each test creates a unique prefix such as `test_location_a1b2c3d4_`; each location adds a timestamp and random suffix. Boulder/problem names are static. The Create step creates each required item once and returns it for the Edit and Delete steps to reuse. Each test calls cleanup in a finally block after its steps, including if a step fails. Cleanup deletes all locations beginning with that test's prefix, including children, via the authenticated app API. Cleanup errors are caught and annotated as warnings without changing pass/fail. Unrelated locations are retained. Prefixes reported in warnings can be used with the cleanup helper if a retry is needed.

Run only CRUD tests: `npm run test:e2e -- --grep CRUD`.
Run one file: `npm run test:e2e -- location-crud.spec.ts`.

Failed runs retain a screenshot and trace. These can include test credentials or tokens, so use disposable local accounts and keep artifacts private. Generated artifacts are ignored by Git. Legacy Cypress artifact ignore rules remain to protect existing local files.
