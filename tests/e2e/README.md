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

`location-crud.spec.ts`, `boulder-crud.spec.ts`, and `problem-crud.spec.ts` each have three report steps: Create, Edit and Delete. They use `testHelpers.ts` for UI steps (login, navigation, creation, editing and deletion) and `apiTestHelpers.ts` for API/DB checks and cleanup. They use the same E2E_EMAIL/E2E_PASSWORD account and run one test at a time with the default configuration. Do not override workers or launch simultaneous runs against the same database yet.

Each test uses a stable prefix (`test_location_`, `test_boulder_`, or `test_problem_`) across runs so cleanup also removes leftovers from previous runs. Each location name adds a timestamp and random suffix to remain unique. Boulder/problem names are static. The Create step creates each required item once and returns it for the Edit and Delete steps to reuse. Each test calls cleanup in a finally block after its steps, including if a step fails. Cleanup deletes all locations beginning with that test's prefix, including children, via the authenticated app API. Cleanup errors are caught and annotated as warnings without changing pass/fail. Unrelated locations are retained. Prefixes reported in warnings can be used with the cleanup helper if a retry is needed.

### Account CRUD

`account-crud.spec.ts` signs up a new account through the UI (`test_account_<timestamp>_<random>@example.com`), confirms it, logs in, edits the display name, height and ape index from the profile page, then deletes the account from the profile page. Each step checks the UI and the session/public-profile APIs; the Delete step also checks that the old credentials are refused.

Email confirmation uses the test code `0000`. `playwright.config.ts` passes `E2E_CONFIRM_CODE=0000` to its own test server only, and the server swaps that code for a real one from Supabase's admin API before the normal verify call. `auth.mjs` refuses to start if `E2E_CONFIRM_CODE` is set with `NODE_ENV=production`, on Render, or with a non-local `SUPABASE_URL`, so it cannot work in production. Real codes are 6 digits, so `0000` never collides with one.

This test needs `SUPABASE_SECRET_KEY` in `.env.local` to be the local **Secret key** (`sb_secret_…`, shown by `npx supabase status`). Cleanup uses the same key to delete leftover `test_account_` accounts from earlier runs.

### Failure triage

In a run, every failed test is **Triage needed**. Open the test and either **Retry** it (or **Retry all**), which re-runs it inside the same run with the run's settings and adds the new attempts to its history, so a pass moves it to **Passed**, or choose **Mark as bugged**. Marking requires a new bug report with a written description, or adding it to an existing open report with an optional note. The error, failed step, screenshot and video are attached automatically. **Unmark** undoes it. Reports are listed on the Bugs page, can be closed or reopened, and are stored in `test-dashboard/bugs/` (git-ignored, because screenshots and videos can show credentials). They are kept separately from the 5-run history, so they outlive the runs they came from.

### Retry headed

On a test that needs triage, **Retry headed** retries it with a visible browser. When the test ends, the browser stays open with the Playwright Inspector so you can look around the app; press **Resume** or close the browser to finish and keep the attempt (Stop ends it without keeping it). It runs one test, with no test timeout. Test data cleanup is skipped for that retry so the app still shows the data; the next normal run removes it by prefix. This relies on specs importing `test`/`expect` from `tests/e2e/fixtures.ts`, whose fixture calls `page.pause()` when `PW_KEEP_OPEN=1` (no effect in headless runs).

### AI analysis

A failed test has an **AI analysis** tab. **Analyse** runs Claude Code in headless mode (`claude -p`) with your signed-in Claude subscription, so it uses your plan's usage and needs no API key. It finds Claude Code on PATH, then the copy bundled with the VS Code extension; set `CLAUDE_CODE_PATH` to override. Claude gets the failure (errors, steps, action timeline, page snapshot, screenshot, previous passing times and recent app changes from git) and can read the test and app source, but it can't run commands or edit files, and `.env` files are blocked. It returns a verdict (UI change, timing issue, app bug or unclear) with evidence. For a UI change or timing issue it proposes test edits, which you apply with **Apply fix** or **Apply and retry**; edits only go to files under `tests/` and are refused if a file changed meanwhile. For an app bug it drafts a bug report that opens pre-filled in **Mark as bugged**. Nothing is changed or filed without your click. The code is in `test-dashboard/analysis.mjs`.

### Code tab

Each test result has a **Code** tab: an editor (Monaco, the editor VS Code is built on, from the `monaco-editor` dev dependency) showing the test source. The failing line is highlighted with the error underneath, the call stack links every frame inside `tests/`, and each `test.step` line shows its result and time. Files under `tests/` can be edited and saved (Ctrl+S); saving is refused if the file changed on disk since it was opened. The tab shows the current file, so if it has changed since the run, highlighted lines may have moved (the tab says so).

### Example failure

`example-failure.spec.ts` logs in, then fails on purpose (`expect(true).toBe(false)`). It is a known failure for trying out the dashboard's failure views, retries and AI analysis. It is tagged `@example`; leave it out of a normal run with `npm run test:e2e -- --grep-invert @example`.

Run only CRUD tests: `npm run test:e2e -- --grep CRUD`.
Run one file: `npm run test:e2e -- location-crud.spec.ts`.

Failed runs retain a screenshot and trace. These can include test credentials or tokens, so use disposable local accounts and keep artifacts private. Generated artifacts are ignored by Git. Legacy Cypress artifact ignore rules remain to protect existing local files.

## Test dashboard

`npm run test:dashboard` starts a local dashboard at http://127.0.0.1:5190 (`DASHBOARD_PORT` to change). It lists the Playwright tests, runs selected tests or all tests with a chosen worker count (optionally headed), streams pass/fail and step progress live, and keeps the last 5 runs in `test-dashboard/.runs/` (git-ignored) with copies of screenshots, videos, traces and error context; older runs and their files are deleted. Each test result has an `analysis` field reserved for AI failure analysis. The dashboard has a Tests view (select tests and run them) and a Results view (all recent runs; open one to see its tests, then go back with the button or Esc) and defaults to a dark theme (toggle in the sidebar).
