/*
 * API helper quick reference
 * These read and clean up persisted data through the app API (or local Supabase admin API),
 * independently of the page UI. UI helpers are in testHelpers.ts.
 *
 * guide                     Read persisted guide data from the app API.
 * sessionUser               Read the signed-in user from the app session API.
 * savedProfile              Convert profile form values to the values the API returns.
 * cleanup                   Delete locations matching a prefix; throws on failure.
 * deleteLocationsWithPrefix Run cleanup and report failures as warnings.
 * cleanupAccounts           Delete accounts whose email matches a prefix; throws on failure.
 * deleteAccountsWithPrefix  Run account cleanup and report failures as warnings.
 *
 * assertLocationExistsDB - Verify location existence and fields through the API.
 *
 * assertLocationRemovedFromDB - Verify location deletion through the API.
 *
 * assertBoulderExistsDB - Verify boulder existence and fields through the API.
 *
 * assertBoulderRemovedFromDB - Verify boulder deletion through the API.
 *
 * assertProblemExistsDB - Verify problem existence and fields through the API.
 *
 * assertProblemRemovedFromDB - Verify problem deletion through the API.
 *
 * assertLocationOldDetailsRemovedFromDB - Verify each edited field no longer has its old value.
 *
 * assertBoulderOldDetailsRemovedFromDB - Verify each edited field no longer has its old value.
 *
 * assertProblemOldDetailsRemovedFromDB - Verify each edited field no longer has its old value.
 *
 * assertAccountExistsDB - Verify the account session and public profile through the API.
 *
 * assertAccountOldDetailsRemovedFromDB - Verify each edited profile field no longer has its old value.
 *
 * assertAccountRemovedFromDB - Verify the account can no longer log in and its profile is gone.
 *
 * Internal helpers
 * adminRequest              Send a request to the local Supabase admin API.
 */

import { expect, type Page, type TestInfo } from '@playwright/test';

/**
 * Read the latest guide through the app API using the browser session.
 * @param page - Page whose request context supplies the session cookies.
 * @returns The parsed guide containing locations, boulders, problems and its revision.
 * @throws If the API request fails.
 */
export async function guide(page: Page) {
  // Fetch the latest persisted guide using the browser session.
  const response = await page.request.get('/api/guide', { timeout: 10000 });
  if (!response.ok()) throw new Error('Reading test guide failed: HTTP ' + response.status());
  return response.json();
}

/**
 * Delete matching locations and their children through the authenticated app API.
 * Matches earlier runs too; locations with other prefixes are preserved.
 * This helper throws on failure. Use deleteLocationsWithPrefix for non-failing test cleanup.
 * @param page - Signed-in browser page with permission to delete the test locations.
 * @param prefix - Prefix beginning with `test_` and containing at least one additional character.
 * @throws If the prefix is unsafe or an API request fails.
 */
export async function cleanup(page: Page, prefix: string) {
  if (!prefix.startsWith('test_') || prefix.length <= 5) throw new Error('Cleanup requires a scoped test_ prefix.');
  // Fetch current data so cleanup preserves unrelated locations and the latest revision.
  const current = await guide(page);
  // Remove only locations whose names start with this test prefix.
  const locations = current.locations.filter((l: any) => !l.name.startsWith(prefix));
  if (locations.length === current.locations.length) return;
  // Persist cleanup through the authenticated app API.
  const response = await page.request.put('/api/guide', { data: { ...current, locations }, timeout: 10000 });
  if (!response.ok()) throw new Error('Cleanup failed: HTTP ' + response.status());
}

/**
 * Skip cleanup during the dashboard's "Retry headed" (PW_KEEP_OPEN=1), so the browser left open at the end
 * still shows the test's data. Cleanup matches by prefix, so the next normal run removes it.
 * @param prefix - Stable test-specific prefix whose cleanup is being skipped.
 * @param info - Playwright test information receiving a note that cleanup was skipped.
 * @returns True when cleanup should be skipped.
 */
function skipCleanupForHeadedRetry(prefix: string, info: TestInfo) {
  if (process.env.PW_KEEP_OPEN !== '1') return false;
  info.annotations.push({ type: 'cleanup skipped', description: `Headed retry: ${prefix} data was kept so the open browser still shows it. The next normal run removes it.` });
  return true;
}

/**
 * Run cleanup without replacing the test result if cleanup fails.
 * Failures are logged and added to the test report as cleanup warning annotations.
 * @param page - Signed-in browser page used for cleanup requests.
 * @param prefix - Stable test-specific location prefix to remove across runs.
 * @param info - Playwright test information receiving any cleanup warning.
 */
export async function deleteLocationsWithPrefix(page: Page, prefix: string, info: TestInfo) {
  if (skipCleanupForHeadedRetry(prefix, info)) return;
  // Catch cleanup failures so they do not replace the actual test result.
  try { await cleanup(page, prefix); }
  catch (error) {
    const warning = 'Cleanup warning for ' + prefix + ': ' + String(error);
    console.warn(warning);
    info.annotations.push({ type: 'cleanup warning', description: warning });
  }
}

/**
 * Verify location existence and expected fields in database-backed GET /api/guide results.
 * This reads the authenticated app API, not SQL directly. Missing parents fail the check.
 * @param page - Signed-in page whose session is used for the API request.
 * @param locationId - ID of the location to locate.
 * @param expectedFields - Submitted values to verify against persisted data.
 */
export async function assertLocationExistsDB(page: Page, locationId: string, expectedFields: Record<string, string>) {
  // Fetch fresh persisted data, independently of the current page UI.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: { id: string }) => item.id === locationId);
  // Verify the record exists and every supplied field was saved correctly.
  expect(savedLocation, 'API/DB: location exists').toBeDefined();
  expect(savedLocation, 'API/DB: location has the expected saved fields').toMatchObject(expectedFields);
}

/**
 * Verify location deletion in database-backed GET /api/guide results.
 * This reads the authenticated app API, not SQL directly. Missing parents fail the check.
 * @param page - Signed-in page whose session is used for the API request.
 * @param locationId - ID of the location to locate.
 */
export async function assertLocationRemovedFromDB(page: Page, locationId: string) {
  // Fetch fresh persisted data, independently of the current page UI.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: { id: string }) => item.id === locationId);
  // Verify this exact ID is absent from persisted data.
  expect(savedLocation, 'API/DB: location was removed').toBeUndefined();
}

/**
 * Verify boulder existence and expected fields in database-backed GET /api/guide results.
 * This reads the authenticated app API, not SQL directly. Missing parents fail the check.
 * @param page - Signed-in page whose session is used for the API request.
 * @param locationId - ID of the location to locate.
 * @param boulderId - ID of the boulder to locate.
 * @param expectedFields - Submitted values to verify against persisted data.
 */
export async function assertBoulderExistsDB(page: Page, locationId: string, boulderId: string, expectedFields: Record<string, string>) {
  // Fetch fresh persisted data, independently of the current page UI.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: { id: string }) => item.id === locationId);
  // A missing parent must not be mistaken for successful child deletion.
  expect(savedLocation, 'API/DB: parent location still exists').toBeDefined();
  const savedBoulder = savedLocation.boulders.find((item: { id: string }) => item.id === boulderId);
  // Verify the record exists and every supplied field was saved correctly.
  expect(savedBoulder, 'API/DB: boulder exists').toBeDefined();
  expect(savedBoulder, 'API/DB: boulder has the expected saved fields').toMatchObject(expectedFields);
}

/**
 * Verify boulder deletion in database-backed GET /api/guide results.
 * This reads the authenticated app API, not SQL directly. Missing parents fail the check.
 * @param page - Signed-in page whose session is used for the API request.
 * @param locationId - ID of the location to locate.
 * @param boulderId - ID of the boulder to locate.
 */
export async function assertBoulderRemovedFromDB(page: Page, locationId: string, boulderId: string) {
  // Fetch fresh persisted data, independently of the current page UI.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: { id: string }) => item.id === locationId);
  // A missing parent must not be mistaken for successful child deletion.
  expect(savedLocation, 'API/DB: parent location still exists').toBeDefined();
  const savedBoulder = savedLocation.boulders.find((item: { id: string }) => item.id === boulderId);
  // Verify this exact ID is absent from persisted data.
  expect(savedBoulder, 'API/DB: boulder was removed').toBeUndefined();
}

/**
 * Verify problem existence and expected fields in database-backed GET /api/guide results.
 * This reads the authenticated app API, not SQL directly. Missing parents fail the check.
 * @param page - Signed-in page whose session is used for the API request.
 * @param locationId - ID of the location to locate.
 * @param boulderId - ID of the boulder to locate.
 * @param problemId - ID of the problem to locate.
 * @param expectedFields - Submitted values to verify against persisted data.
 */
export async function assertProblemExistsDB(page: Page, locationId: string, boulderId: string, problemId: string, expectedFields: Record<string, string>) {
  // Fetch fresh persisted data, independently of the current page UI.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: { id: string }) => item.id === locationId);
  // A missing parent must not be mistaken for successful child deletion.
  expect(savedLocation, 'API/DB: parent location still exists').toBeDefined();
  const savedBoulder = savedLocation.boulders.find((item: { id: string }) => item.id === boulderId);
  // A missing parent must not be mistaken for successful child deletion.
  expect(savedBoulder, 'API/DB: parent boulder still exists').toBeDefined();
  const savedProblem = savedBoulder.problems.find((item: { id: string }) => item.id === problemId);
  // Verify the record exists and every supplied field was saved correctly.
  expect(savedProblem, 'API/DB: problem exists').toBeDefined();
  expect(savedProblem, 'API/DB: problem has the expected saved fields').toMatchObject(expectedFields);
}

/**
 * Verify problem deletion in database-backed GET /api/guide results.
 * This reads the authenticated app API, not SQL directly. Missing parents fail the check.
 * @param page - Signed-in page whose session is used for the API request.
 * @param locationId - ID of the location to locate.
 * @param boulderId - ID of the boulder to locate.
 * @param problemId - ID of the problem to locate.
 */
export async function assertProblemRemovedFromDB(page: Page, locationId: string, boulderId: string, problemId: string) {
  // Fetch fresh persisted data, independently of the current page UI.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: { id: string }) => item.id === locationId);
  // A missing parent must not be mistaken for successful child deletion.
  expect(savedLocation, 'API/DB: parent location still exists').toBeDefined();
  const savedBoulder = savedLocation.boulders.find((item: { id: string }) => item.id === boulderId);
  // A missing parent must not be mistaken for successful child deletion.
  expect(savedBoulder, 'API/DB: parent boulder still exists').toBeDefined();
  const savedProblem = savedBoulder.problems.find((item: { id: string }) => item.id === problemId);
  // Verify this exact ID is absent from persisted data.
  expect(savedProblem, 'API/DB: problem was removed').toBeUndefined();
}

/**
 * Verify each supplied old field value has been replaced on the same location ID.
 * Reads persisted data through GET /api/guide, not direct SQL.
 * Only pass fields deliberately changed by the edit; other records may share these values.
 * @param page - Signed-in page used for the API request.
 * @param locationId - ID of the location to locate.
 * @param oldFields - Field names mapped to their values before the edit.
 */
export async function assertLocationOldDetailsRemovedFromDB(page: Page, locationId: string, oldFields: Record<string, string>) {
  // Fetch fresh persisted data, independently of the current page UI.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: { id: string }) => item.id === locationId);
  // Deletion must not count as successfully editing the record.
  expect(savedLocation, 'API/DB: edited location still exists').toBeDefined();
  // Check every old value separately so one changed field cannot hide another unchanged field.
  expect(Object.keys(oldFields).length, 'At least one old field must be checked').toBeGreaterThan(0);
  for (const [field, oldValue] of Object.entries(oldFields)) {
    expect(savedLocation, 'API/DB: edited field remains present: ' + field).toHaveProperty(field);
    expect(savedLocation[field], 'API/DB: location no longer has the old ' + field).not.toEqual(oldValue);
  }
}

/**
 * Verify each supplied old field value has been replaced on the same boulder ID.
 * Reads persisted data through GET /api/guide, not direct SQL.
 * Only pass fields deliberately changed by the edit; other records may share these values.
 * @param page - Signed-in page used for the API request.
 * @param locationId - ID of the location to locate.
 * @param boulderId - ID of the boulder to locate.
 * @param oldFields - Field names mapped to their values before the edit.
 */
export async function assertBoulderOldDetailsRemovedFromDB(page: Page, locationId: string, boulderId: string, oldFields: Record<string, string>) {
  // Fetch fresh persisted data, independently of the current page UI.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: { id: string }) => item.id === locationId);
  // A missing parent must not be mistaken for successful child deletion.
  expect(savedLocation, 'API/DB: parent location still exists').toBeDefined();
  const savedBoulder = savedLocation.boulders.find((item: { id: string }) => item.id === boulderId);
  // Deletion must not count as successfully editing the record.
  expect(savedBoulder, 'API/DB: edited boulder still exists').toBeDefined();
  // Check every old value separately so one changed field cannot hide another unchanged field.
  expect(Object.keys(oldFields).length, 'At least one old field must be checked').toBeGreaterThan(0);
  for (const [field, oldValue] of Object.entries(oldFields)) {
    expect(savedBoulder, 'API/DB: edited field remains present: ' + field).toHaveProperty(field);
    expect(savedBoulder[field], 'API/DB: boulder no longer has the old ' + field).not.toEqual(oldValue);
  }
}

/**
 * Verify each supplied old field value has been replaced on the same problem ID.
 * Reads persisted data through GET /api/guide, not direct SQL.
 * Only pass fields deliberately changed by the edit; other records may share these values.
 * @param page - Signed-in page used for the API request.
 * @param locationId - ID of the location to locate.
 * @param boulderId - ID of the boulder to locate.
 * @param problemId - ID of the problem to locate.
 * @param oldFields - Field names mapped to their values before the edit.
 */
export async function assertProblemOldDetailsRemovedFromDB(page: Page, locationId: string, boulderId: string, problemId: string, oldFields: Record<string, string>) {
  // Fetch fresh persisted data, independently of the current page UI.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: { id: string }) => item.id === locationId);
  // A missing parent must not be mistaken for successful child deletion.
  expect(savedLocation, 'API/DB: parent location still exists').toBeDefined();
  const savedBoulder = savedLocation.boulders.find((item: { id: string }) => item.id === boulderId);
  // A missing parent must not be mistaken for successful child deletion.
  expect(savedBoulder, 'API/DB: parent boulder still exists').toBeDefined();
  const savedProblem = savedBoulder.problems.find((item: { id: string }) => item.id === problemId);
  // Deletion must not count as successfully editing the record.
  expect(savedProblem, 'API/DB: edited problem still exists').toBeDefined();
  // Check every old value separately so one changed field cannot hide another unchanged field.
  expect(Object.keys(oldFields).length, 'At least one old field must be checked').toBeGreaterThan(0);
  for (const [field, oldValue] of Object.entries(oldFields)) {
    expect(savedProblem, 'API/DB: edited field remains present: ' + field).toHaveProperty(field);
    expect(savedProblem[field], 'API/DB: problem no longer has the old ' + field).not.toEqual(oldValue);
  }
}

/** Profile form values as entered on the sign-up and Your profile forms. */
export type ProfileFormFields = { name: string, heightFeet: string, heightInches: string, apeIndex: string };

/**
 * Convert profile form values to the values stored and returned by the API.
 * Height is entered in feet and inches but saved in centimetres; Not sure saves a null ape index.
 * @param fields - Profile form values.
 * @returns Display name, height in centimetres and ape index in inches.
 */
export function savedProfile(fields: ProfileFormFields) {
  return {
    name: fields.name,
    height: Math.round((Number(fields.heightFeet) * 12 + Number(fields.heightInches)) * 2.54),
    apeIndex: fields.apeIndex === 'unknown' ? null : Number(fields.apeIndex),
  };
}

/**
 * Read the signed-in user from the app session API.
 * @param page - Page whose request context supplies the session cookies.
 * @returns The signed-in user, or null when the session is anonymous.
 * @throws If the API request fails.
 */
export async function sessionUser(page: Page) {
  // Fetch the session using the browser cookies, independently of the current page UI.
  const response = await page.request.get('/api/session', { timeout: 10000 });
  if (!response.ok()) throw new Error('Reading test session failed: HTTP ' + response.status());
  return (await response.json()).user;
}

/**
 * Send an authenticated request to the local Supabase admin API used for account cleanup.
 * @param route - Supabase path, such as `/auth/v1/admin/users`.
 * @param init - Fetch options; headers are supplied here.
 * @returns The successful response.
 * @throws If the admin key is missing, Supabase is not local or the request fails.
 */
async function adminRequest(route: string, init: RequestInit = {}) {
  const base = process.env.E2E_SUPABASE_URL, key = process.env.E2E_ADMIN_KEY;
  if (!base || !key) throw new Error('Account cleanup requires SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.');
  // Cleanup deletes accounts, so never send it anywhere but local Supabase.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Account cleanup requires local Supabase.');
  const response = await fetch(base.replace(/\/$/, '') + route, { ...init, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Supabase admin request ' + route.split('?')[0] + ' failed: HTTP ' + response.status);
  return response;
}

/**
 * Delete every account whose email starts with the prefix, including leftovers from earlier runs.
 * Mirrors the app's deletion: contributions are kept and credited to Deleted User.
 * This helper throws on failure. Use deleteAccountsWithPrefix for non-failing test cleanup.
 * @param prefix - Prefix beginning with `test_` and containing at least one additional character.
 * @throws If the prefix is unsafe or a Supabase admin request fails.
 */
export async function cleanupAccounts(prefix: string) {
  if (!prefix.startsWith('test_') || prefix.length <= 5) throw new Error('Cleanup requires a scoped test_ prefix.');
  // Find only accounts created by this test.
  const { users } = await (await adminRequest('/auth/v1/admin/users?page=1&per_page=1000')).json();
  for (const user of users.filter((u: { email?: string }) => u.email?.startsWith(prefix))) {
    // Release owned records and files, then delete the auth user and its profile.
    await adminRequest('/rest/v1/rpc/prepare_account_deletion', { method: 'POST', body: JSON.stringify({ target_user: user.id }) });
    await adminRequest('/auth/v1/admin/users/' + encodeURIComponent(user.id), { method: 'DELETE' });
  }
}

/**
 * Run account cleanup without replacing the test result if cleanup fails.
 * Failures are logged and added to the test report as cleanup warning annotations.
 * @param prefix - Stable test-specific email prefix to remove across runs.
 * @param info - Playwright test information receiving any cleanup warning.
 */
export async function deleteAccountsWithPrefix(prefix: string, info: TestInfo) {
  if (skipCleanupForHeadedRetry(prefix, info)) return;
  // Catch cleanup failures so they do not replace the actual test result.
  try { await cleanupAccounts(prefix); }
  catch (error) {
    const warning = 'Cleanup warning for ' + prefix + ': ' + String(error);
    console.warn(warning);
    info.annotations.push({ type: 'cleanup warning', description: warning });
  }
}

/**
 * Verify the signed-in account and its public profile through the app API.
 * Checks both the session (what the user sees) and the public profile (what others see).
 * @param page - Signed-in page whose session is used for the API requests.
 * @param accountId - ID of the account to check.
 * @param expectedFields - Saved display name, height in centimetres and ape index; see savedProfile.
 */
export async function assertAccountExistsDB(page: Page, accountId: string, expectedFields: Record<string, unknown>) {
  // Fetch the session user, independently of the current page UI.
  const user = await sessionUser(page);
  expect(user, 'API/DB: account is signed in').not.toBeNull();
  expect(user.id, 'API/DB: session belongs to this account').toBe(accountId);
  expect(user, 'API/DB: account has the expected saved fields').toMatchObject({ ...expectedFields, profileComplete: true });
  // Fetch the public profile other users see.
  const response = await page.request.get('/api/public-profile?id=' + encodeURIComponent(accountId), { timeout: 10000 });
  expect(response.status(), 'API/DB: public profile exists').toBe(200);
  expect(await response.json(), 'API/DB: public profile has the expected saved fields').toMatchObject({ id: accountId, ...expectedFields });
}

/**
 * Verify each supplied old profile value has been replaced on the same account.
 * Reads the session and public profile APIs, not direct SQL.
 * Only pass fields deliberately changed by the edit.
 * @param page - Signed-in page used for the API requests.
 * @param accountId - ID of the edited account.
 * @param oldFields - Saved field names mapped to their values before the edit.
 */
export async function assertAccountOldDetailsRemovedFromDB(page: Page, accountId: string, oldFields: Record<string, unknown>) {
  // Fetch fresh session and public profile data.
  const user = await sessionUser(page);
  expect(user?.id, 'API/DB: edited account is still signed in').toBe(accountId);
  const response = await page.request.get('/api/public-profile?id=' + encodeURIComponent(accountId), { timeout: 10000 });
  expect(response.status(), 'API/DB: edited public profile still exists').toBe(200);
  const profile = await response.json();
  // Check every old value separately so one changed field cannot hide another unchanged field.
  expect(Object.keys(oldFields).length, 'At least one old field must be checked').toBeGreaterThan(0);
  for (const [field, oldValue] of Object.entries(oldFields)) {
    expect(user, 'API/DB: edited field remains present: ' + field).toHaveProperty(field);
    expect(user[field], 'API/DB: account no longer has the old ' + field).not.toEqual(oldValue);
    expect(profile[field], 'API/DB: public profile no longer has the old ' + field).not.toEqual(oldValue);
  }
}

/**
 * Verify a deleted account is signed out, has no public profile and can no longer log in.
 * @param page - Page that was signed in as the deleted account.
 * @param account - The deleted account's ID, email and password.
 */
export async function assertAccountRemovedFromDB(page: Page, account: { id: string, email: string, password: string }) {
  // Verify the server session was ended.
  expect(await sessionUser(page), 'API/DB: deleted account session ended').toBeNull();
  // Verify the public profile is gone.
  const profile = await page.request.get('/api/public-profile?id=' + encodeURIComponent(account.id), { timeout: 10000 });
  expect(profile.status(), 'API/DB: public profile was removed').toBe(404);
  // Verify the credentials are rejected.
  const login = await page.request.post('/api/login', { data: { email: account.email, password: account.password }, timeout: 10000 });
  expect(login.status(), 'API/DB: deleted account can no longer log in').toBe(401);
}
