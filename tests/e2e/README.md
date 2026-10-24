# Playwright browser tests

Start Docker Desktop and local Supabase (`npx supabase start`). Keep SUPABASE_URL and the local keys in .env.local. Keep the existing E2E_EMAIL and E2E_PASSWORD for a confirmed local email account with a completed profile.

Install Chromium once with `npm run test:e2e:install`.

- `npm run test:e2e:open`: interactive test UI.
- `npm run test:e2e`: headless run with terminal results.
- `npm run test:e2e:headed`: watch the live browser.
- `npm run test:e2e:debug`: pause and step through the test.
- `npm run test:e2e:report`: view the latest HTML results.
- `npm run test:e2e -- --grep CRUD`: run only the CRUD tests.
- `npm run test:e2e -- location-crud.spec.ts`: run one file.

Playwright starts and stops its own app server on http://127.0.0.1:5174 using the same environment as the tests. No manual npm run dev is needed. An existing server on that port is rejected instead of reused. The configuration rejects non-local Supabase URLs.

The login/logout test uses real local authentication and checks the form, session persistence on reload, logout, cleared cookie, anonymous server session and reload after logout. Existing Node/database tests are unchanged. One worker is intentional until more tests and isolated test data are added.

## CRUD tests

`location-crud.spec.ts`, `boulder-crud.spec.ts`, and `problem-crud.spec.ts` each have three report steps: Create, Edit and Delete. They use `testHelpers.ts` for UI steps (login, navigation, creation, editing and deletion) and `apiTestHelpers.ts` for API/DB checks and cleanup. They use the same E2E_EMAIL/E2E_PASSWORD account. The suite runs 3 workers by default, with each spec file in one worker. Saves only conflict (HTTP 409) when two saves change the same record, so different specs can run in parallel. Do not run the same spec twice at once against one database: its prefix cleanup would delete the other run's data. All workers share the account's post limits (25 locations, 50 boulders, 250 problems).

Each test uses a stable prefix (`test_location_`, `test_boulder_`, or `test_problem_`) across runs so cleanup also removes leftovers from previous runs. Each location name adds a timestamp and random suffix to remain unique. Boulder/problem names are static. The Create step creates each required item once and returns it for the Edit and Delete steps to reuse. Each test calls cleanup in a finally block after its steps, including if a step fails. Cleanup deletes all locations beginning with that test's prefix, including children, via the authenticated app API. Cleanup errors are caught and annotated as warnings without changing pass/fail. Unrelated locations are retained. Prefixes reported in warnings can be used with the cleanup helper if a retry is needed.

### Account CRUD

`account-crud.spec.ts` signs up a new account through the UI (`test_account_<timestamp>_<random>@example.com`), confirms it, logs in, edits the display name, height and ape index from the profile page, then deletes the account from the profile page. Each step checks the UI and the session/public-profile APIs; the Delete step also checks that the old credentials are refused.

Email confirmation uses the test code `0000`. `playwright.config.ts` passes `E2E_CONFIRM_CODE=0000` to its own test server only, and the server swaps that code for a real one from Supabase's admin API before the normal verify call. `auth.mjs` refuses to start if `E2E_CONFIRM_CODE` is set with `NODE_ENV=production`, on Render, or with a non-local `SUPABASE_URL`, so it cannot work in production. Real codes are 6 digits, so `0000` never collides with one.

This test needs `SUPABASE_SECRET_KEY` in `.env.local` to be the local **Secret key** (`sb_secret_…`, shown by `npx supabase status`). Cleanup uses the same key to delete leftover `test_account_` accounts from earlier runs.

### Permissions

`permissions.spec.ts` checks who can change what, through both the UI (edit and remove controls are offered or hidden) and the API (the same change returns 200 or 403/401). This matters because a hidden button doesn't stop a direct API call. It uses an owner, a second contributor, an admin and a signed-out guest:

- A guest can browse but not save or upload.
- Another user can't edit or remove the owner's location, links, parking photos, boulder, photos, videos, problem, annotations or attachments, even with a photo they own.
- Another user can add boulders, problems and photos beneath the owner's records, is credited for them, and can edit and remove them. The owner can't edit those additions.
- The owner can edit and remove their own records, but can't remove a boulder holding another user's problem.
- An admin can edit and remove anything, including a location holding several users' content.

The accounts (`test_perm_user_…`) are created through the local Supabase admin API, so the sign-up form is only exercised by the account CRUD test. The admin role is granted by running SQL in the `supabase_db_<project_id>` Docker container, because the role table can't be written through any API. Each account signs in once per worker and the session is reused across tests. Data is seeded through the API with `seedHelpers.ts`. Tests that change data seed their own location. Cleanup runs as the admin, the only user who can remove locations holding several users' content, before the accounts are deleted.

### Feature tests

Each of these specs uses its own account (`testUser` in `seedHelpers.ts`), created through the admin API and signed in once per worker. Each test seeds its own location through the API, and the location and account are removed afterwards.

- `search-map.spec.ts`: filtering (case and surrounding spaces ignored), opening a result, keyboard browsing, Create location shown only to signed-in users, map markers and the "N mapped" count, and the tile-error notice.
- `coordinates.spec.ts`: a map click fills in the coordinates, typed coordinates place and move the marker, invalid coordinates remove the marker and block saving, the location page shows the coordinates and a Google Maps link, and the edit dialog starts at the saved point and saves a newly picked one.
- `location-page.spec.ts`: boulder, problem, photo and video counts on the location and boulder banners, and adding, editing, removing and validating additional links.
- `photos.spec.ts`: JPEG/PNG/WebP boulder photo uploads with naming, rejection of unsupported types, files over 8 MB and disguised files, blank and duplicate names, removal (a photo a problem uses only leaves the boulder page; an unused one is deleted), and parking photos with captions.
- `videos.spec.ts`: MP4/WebM/MOV uploads on a problem page with download links, no videos on the boulder page but photo and video counts on its problem rows, rejection of unsupported types, files over 100 MB and disguised files, and removal.
- `problem-media.spec.ts`: reusing boulder photos and other problems' topos on a problem with separate markings, adding videos left on the boulder, uploading straight from a problem (kept off the boulder page), unlinking a photo while other problems keep it, deleting media only one problem used when it is removed from that problem or the problem is removed, and Edit problem keeping media.
- `annotations.spec.ts`: drawing each tool's shape and saving it on the 0–1000 grid; erase, undo, clear and cancel; annotations kept separately per problem on a shared photo; closing with unsaved changes (Escape, ✕ or Cancel) asking "Discard your unsaved annotations?" first, but not when nothing changed or when saving; and the editor staying open while saving.
- `conflicts.spec.ts`: two tabs stand in for two people. Out-of-date saves to different records both succeed, an out-of-date edit to the same record gets HTTP 409 with an explanation until the tab reloads, and removing a boulder that has gained a problem the tab hasn't seen is refused.
- `logbook.spec.ts`: logging and unlogging (the Done badge, profile entries and their links), removing climbs from your own logbook only, problems deleted after logging shown as "(deleted)", and guests refused.
- `friends.spec.ts`: inviting by display name and accepting, cancelling and declining invites, removing a friend after confirming, unknown names, and a friend's logbook with all sends or only mutual ones. It uses six accounts so each test has its own pair.
- `profile.spec.ts`: uploading and removing a profile photo, rejecting unsupported or oversized photos and other users' uploads, and a visitor seeing a creator's public profile without the owner's controls.
- `auth.spec.ts`: login errors, sign-up refusing a taken display name and a short password, password recovery using the code from the real email, wrong recovery codes, an incomplete profile blocking contributions until completed, the account menu, continuing as a guest, and starting Google sign-in (with the server call stubbed) and its error message.
- `navigation.spec.ts`: the breadcrumb trail, deep links for signed-out visitors, and "not found" pages.
- `limits.spec.ts`: 25 locations, 50 boulders and 250 problems per user, 50 photos and videos per location, and text length limits, through the API and, where the app checks first, the UI. Each limit uses its own account.
- `permissions.spec.ts` also covers a deleted user's content: it's credited to Deleted User and only an admin can change it.
- `validation.spec.ts`: required fields on the location, boulder and problem forms (empty fields are blocked by the browser, so the tests check the field is invalid and nothing was saved; text of only spaces must get the app's own message), length caps when typing, and names containing HTML shown as text without running.
- `failures.spec.ts`: simulated network and server failures. A failed save keeps the dialog and what was typed and can be retried; server messages such as rate limiting are shown; a guide that fails to load shows an error; and dropped connections or HTML error pages must get a readable message.

Unhappy paths are also covered in the existing specs:

- coordinates and links at their limits
- the profile's display name rules, and profile photo contents and replacement
- a new account reusing a deleted account's display name inheriting none of its data
- mixed upload batches, the exact 8 MB photo size, failed uploads and retrying
- a freed media slot and the 10 GB storage allowance (set with `runSql`)
- login, sign-up, confirmation and recovery codes not revealing which emails have accounts and working only once
- the delete-account confirmation, and saving after the session ended elsewhere
- logging a problem that was deleted meanwhile
- invite edge cases
- friends errors and the 50-invite limit
- removed media freeing storage, and partial upload failures leaving no files
- invalid content sent straight to the API, bypassing the forms
- Escape and ✕ on dialogs, including while saving
- `/media` links for guests, missing files and malformed paths
- other sessions ending after an account deletion or password reset
- no response about another user revealing their email or role
- a display-name change showing up everywhere
- an admin managing other users' media
- cancelling an edit or removal in the CRUD specs, which now use their own accounts

The database tests (`npm test --prefix supabase/tests`) now run all 13 files, and `npm test` includes `navigation.test.mjs`.

Password recovery reads the emailed code from Mailpit, which local Supabase uses to capture all email (http://127.0.0.1:54324; override with `E2E_MAILPIT_URL`).

Each spec's cleanup prefixes must not start with another spec's prefix. Cleanup deletes every location starting with its prefix, and a location owned by another account makes the whole cleanup save fail with 403.

`media.ts` generates real sample images and videos with `ffmpeg-static` on first use and caches them in the OS temp folder. Map tiles are served blank locally (`blockMapTiles` in `fixtures.ts`), so no test depends on OpenStreetMap. Tests close the tabs they open after each test (`closeTabs`): the dev server's live-reload connection keeps each open tab holding one of Chromium's 6 connections per host, so a context with 6 open tabs stalls.

Tests that catch real app bugs are left failing so they show up in runs. Each one has a comment above it describing the bug.

### Rate limits

Playwright's test server runs with `E2E_RELAX_LIMITS=1`, which raises the app's rate limits 100-fold. Every worker sends from 127.0.0.1, so they would otherwise share one IP's allowance of 20 logins per 10 minutes and 60 writes per minute, and a growing suite would fail with HTTP 429. The server refuses to start with it in production, on Render, or against non-local Supabase. The real limits are covered by `tests/request-limits.test.mjs`.

### Failure triage

In a run, every failed test is **Triage needed**. Open the test and either **Retry** it (or **Retry all**), which re-runs it inside the same run with the run's settings and adds the new attempts to its history, so a pass moves it to **Passed**, or choose **Mark as bugged**. Marking creates a new bug report with a written description, or adds the failure to any existing report with an optional note. One report can hold failures from several tests, and from the same test across runs: if the test is already in a report, the dialog opens on **Add to existing** with that report selected. Adding to a closed report offers **Reopen this report** (ticked by default), for when a bug comes back; the report then shows when it was reopened. The error, failed step, screenshot and video are attached automatically. **Unmark** undoes it. Reports are listed on the Bugs page, can be closed or reopened, and have **Run attached tests**, which runs every test linked to the report (1 worker, 250 ms slow-mo, one attempt) and opens the run, to check whether the bug still happens. Reports are stored in `test-dashboard/bugs/` (git-ignored, because screenshots and videos can show credentials). They are kept separately from the 5-run history, so they outlive the runs they came from.

### Retry headed

On a test that needs triage, **Retry headed** retries it with a visible browser. When the test ends, the browser stays open with the Playwright Inspector so you can look around the app; press **Resume** or close the browser to finish and keep the attempt (Stop ends it without keeping it). It runs one test, with no test timeout. Test data cleanup is skipped for that retry so the app still shows the data; the next normal run removes it by prefix. This relies on specs importing `test`/`expect` from `tests/e2e/fixtures.ts`, whose fixture calls `page.pause()` when `PW_KEEP_OPEN=1` (no effect in headless runs).

### AI analysis

A failed test has an **AI analysis** tab. **Analyse** runs Claude Code in headless mode (`claude -p`) with your signed-in Claude subscription, so it uses your plan's usage and needs no API key. It finds Claude Code on PATH, then the copy bundled with the VS Code extension; set `CLAUDE_CODE_PATH` to override. Claude gets the failure (errors, steps, action timeline, page snapshot, screenshot, previous passing times and recent app changes from git) and can read the test and app source, but it can't run commands or edit files, and `.env` files are blocked. It returns a verdict (UI change, timing issue, app bug or unclear) with evidence. For a UI change or timing issue it proposes test edits, which you apply with **Apply fix** or **Apply and retry**; edits only go to files under `tests/` and are refused if a file changed meanwhile. For an app bug it first compares the failure with the existing bug reports (titles, descriptions, tests and latest errors; reports that already include this test come first). If one has the same cause, it's shown first with the reason, and **Add to** (or **Reopen and add to**, for a closed report) opens **Mark as bugged** with that report selected. It also drafts a new report, offered as **Create new report** if you disagree with the match. Nothing is changed or filed without your click. The code is in `test-dashboard/analysis.mjs`.

### Code tab

Each test result has a **Code** tab: an editor (Monaco, the editor VS Code is built on, from the `monaco-editor` dev dependency) showing the test source. The failing line is highlighted with the error underneath, the call stack links every frame inside `tests/`, and each `test.step` line shows its result and time. Files under `tests/` can be edited and saved (Ctrl+S); saving is refused if the file changed on disk since it was opened. The tab shows the current file, so if it has changed since the run, highlighted lines may have moved (the tab says so).

Failed runs retain a screenshot and trace. These can include test credentials or tokens, so use disposable local accounts and keep artifacts private. Generated artifacts are ignored by Git. Legacy Cypress artifact ignore rules remain to protect existing local files.

## Test dashboard

`npm run test:dashboard` starts a local dashboard at http://127.0.0.1:5190 (`DASHBOARD_PORT` to change). It lists the Playwright tests, runs selected tests or all tests with a chosen worker count (optionally headed), streams pass/fail and step progress live, and keeps the last 5 runs in `test-dashboard/.runs/` (git-ignored) with copies of screenshots, videos, traces and error context; older runs and their files are deleted. Each test result has an `analysis` field reserved for AI failure analysis. The dashboard has a Tests view (select tests and run them) and a Results view (all recent runs; open one to see its tests, then go back with the button or Esc) and defaults to a dark theme (toggle in the sidebar).
