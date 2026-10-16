/*
 * Helper quick reference
 *
 * locationName              Generate a unique name with a stable cleanup prefix.
 * login                     Sign in through the UI and verify success.
 * guide                     Read persisted guide data from the app API.
 * navigate                  Open Explore or a location, boulder or problem page.
 * createLocation            Create and verify a location; return its saved record.
 * createBoulder             Create and verify a boulder; return its saved record.
 * createProblem             Create and verify a problem; return its saved record.
 * editItem                  Edit the current item and verify its saved heading.
 * deleteItem                Confirm removal of the current item.
 * cleanup                   Delete locations matching a prefix; throws on failure.
 * deleteLocationsWithPrefix Run cleanup and report failures as warnings.
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
 * Internal helpers
 * submit                    Submit a dialog and verify the save response.
 * fill                      Populate the active dialog's fields.
 */

import { expect, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Build a unique location name while retaining a stable cleanup prefix.
 * @param prefix - Test-specific prefix, such as `test_problem_`.
 * @returns The prefix followed by a timestamp and random suffix.
 */
export const locationName = (prefix: string) => prefix + Date.now() + '_' + randomUUID().slice(0, 6);
/**
 * Log in through the UI using E2E_EMAIL and E2E_PASSWORD and verify the signed-in page.
 * @param page - Browser page to sign in on.
 * @throws If credentials are missing or login assertions fail.
 */
export async function login(page: Page) {
  // Read credentials without embedding them in test source.
  const { E2E_EMAIL: email, E2E_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error('Set E2E_EMAIL and E2E_PASSWORD in .env.local.');
  // Open the login form.
  await page.goto('/#login');
  // Enter the account credentials and submit the form.
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  // Verify successful navigation after login.
  await expect(page).toHaveURL(/#explore$/);
  // Verify the signed-in account menu is available.
  await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible();
}
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
 * Open Explore or a detail page and verify it is ready for interaction.
 * Explore is reloaded to refresh the guide after API cleanup. Requires a signed-in session.
 * @param page - Browser page to navigate.
 * @param location - Location ID; omit to open Explore.
 * @param boulder - Boulder ID within the supplied location, if needed.
 * @param problem - Problem ID within the supplied boulder, if needed.
 */
export async function navigate(page: Page, location?: string, boulder?: string, problem?: string) {
  // Build the hash route for the requested location, boulder or problem.
  const params = new URLSearchParams();
  if (location) params.set('location', location);
  if (boulder) params.set('boulder', boulder);
  if (problem) params.set('problem', problem);
  // Navigate to the requested page.
  await page.goto('/#' + (location ? params.toString() : 'explore'));
  // Hash navigation alone keeps the previous guide revision after API cleanup.
  if (!location) await page.reload();
  // Verify the signed-in account menu is available.
  await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible();
  // Verify the destination page is ready for interaction.
  if (location) await expect(page.locator('.detail-banner')).toBeVisible();
  else await expect(page.getByRole('button', { name: /Create location/ })).toBeEnabled();
}
/**
 * Submit the active dialog and verify a successful guide write and dialog closure.
 * @param page - Browser page with an open form or confirmation dialog.
 * @param label - Exact accessible name of the dialog submit button.
 */
async function submit(page: Page, label: string) {
  // Start listening before clicking so a fast save response is not missed.
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  // Submit the active form or deletion confirmation.
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  // Verify the server accepted the write.
  const response = await saved;
  expect(response.status(), 'Guide write succeeded').toBe(200);
  // Verify the dialog closed after saving.
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
/**
 * Populate fields in the active dialog; grade fields use dropdown selection.
 * @param page - Browser page containing the active dialog.
 * @param fields - Input names mapped to the values to enter.
 */
async function fill(page: Page, fields: Record<string, string>) {
  // Fill each named field, using dropdown selection for grades.
  for (const [name, value] of Object.entries(fields)) {
    const input = page.getByRole('dialog').locator('[name="' + name + '"]');
    if (name === 'grade') await input.selectOption(value);
    else await input.fill(value);
  }
}
/**
 * Create a location through the UI and verify its heading and persisted fields.
 * @param page - Signed-in browser page.
 * @param prefix - Stable test-specific prefix used for naming and cleanup.
 * @returns The saved location, including its ID and generated name.
 */
export async function createLocation(page: Page, prefix: string) {
  // Open the locations search page.
  await navigate(page);
  // Open the location creation form.
  await page.getByRole('button', { name: /Create location/ }).click();
  // Provide valid example values for the new item.
  const fields = { name: locationName(prefix), latitude: '56.8', longitude: '-3.2', approach: 'Follow the test path from the parking area.' };
  // Fill the form with the supplied values.
  await fill(page, fields);
  // Save the form and verify the response and dialog state.
  await submit(page, 'Save location');
  // Verify the new item is displayed with its expected heading.
  await expect(page.getByRole('heading', { name: fields.name, exact: true })).toBeVisible();
  // Find the created location in persisted data.
  const savedGuide = await guide(page);
  const location = savedGuide.locations.find((item: any) => item.name === fields.name);
  // Verify all submitted fields were persisted.
  expect(location, 'location was created with the submitted values').toMatchObject(fields);
  return location;
}
/**
 * Create a boulder named Test Boulder and verify its heading and persisted fields.
 * @param page - Signed-in browser page.
 * @param location - Parent location record containing its ID.
 * @returns The saved boulder, including its ID.
 */
export async function createBoulder(page: Page, location: any) {
  // Open the parent location.
  await navigate(page, location.id);
  // Open the boulder creation form.
  await page.getByRole('button', { name: /Add boulder/ }).click();
  // Provide valid example values for the new item.
  const fields = { name: 'Test Boulder', notes: 'Walk ten metres past the gate.', otherNotes: 'Granite with a flat landing.' };
  // Fill the form with the supplied values.
  await fill(page, fields);
  // Save the form and verify the response and dialog state.
  await submit(page, 'Save boulder');
  // Verify the new item is displayed with its expected heading.
  await expect(page.getByRole('heading', { name: fields.name, exact: true })).toBeVisible();
  // Find the created boulder under its parent location.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: any) => item.id === location.id);
  // Fail clearly if the parent is missing.
  expect(savedLocation, "Parent location exists").toBeDefined();
  const boulder = savedLocation.boulders.find((item: any) => item.name === fields.name);
  // Verify all submitted fields were persisted.
  expect(boulder, 'boulder was created with the submitted values').toMatchObject(fields);
  return boulder;
}
/**
 * Create a problem named Test Problem and verify its persisted fields and detail heading.
 * @param page - Signed-in browser page.
 * @param location - Parent location record containing its ID.
 * @param boulder - Parent boulder record containing its ID.
 * @returns The saved problem, including its ID.
 */
export async function createProblem(page: Page, location: any, boulder: any) {
  // Open the parent boulder.
  await navigate(page, location.id, boulder.id);
  // Open the problem creation form.
  await page.getByRole('button', { name: /Add problem/ }).click();
  // Provide valid example values for the new item.
  const fields = { name: 'Test Problem', grade: 'V1 (5)', description: 'Start on the low holds and climb straight up.' };
  // Fill the form with the supplied values.
  await fill(page, fields);
  // Save the form and verify the response and dialog state.
  await submit(page, 'Save problem');
  // Locate the created problem within its location and boulder.
  const savedGuide = await guide(page);
  const savedLocation = savedGuide.locations.find((item: any) => item.id === location.id);
  // Fail clearly if either parent is missing.
  expect(savedLocation, "Parent location exists").toBeDefined();
  const savedBoulder = savedLocation.boulders.find((item: any) => item.id === boulder.id);
  expect(savedBoulder, "Parent boulder exists").toBeDefined();
  const problem = savedBoulder.problems.find((item: any) => item.name === fields.name);
  // Verify all submitted fields were persisted.
  expect(problem, 'problem was created with the submitted values').toMatchObject(fields);
  // Open the created problem to verify its visible title.
  await navigate(page, location.id, boulder.id, problem.id);
  // Verify the new item is displayed with its expected heading.
  await expect(page.getByRole('heading', { name: fields.grade + ' - ' + fields.name, exact: true })).toBeVisible();
  return problem;
}
/**
 * Edit the current detail-page item, save it and verify its name after reloading.
 * @param page - Signed-in browser page showing the item to edit.
 * @param kind - Item type: `location`, `boulder` or `problem`.
 * @param fields - Form field names and replacement values; must include `name`.
 */
export async function editItem(page: Page, kind: string, fields: Record<string, string>) {
  // Open the edit form for the current item.
  await page.getByRole('button', { name: new RegExp('^Edit ' + kind) }).click();
  // Fill the form with the supplied values.
  await fill(page, fields);
  // Save the form and verify the response and dialog state.
  await submit(page, 'Save ' + kind);
  // Reload to verify the saved name survives a fresh page load.
  await page.reload();
  // Verify the updated name appears in the page banner.
  await expect(page.locator('.detail-banner')).toContainText(fields.name);
}
/**
 * Remove the current detail-page item through its confirmation dialog.
 * @param page - Signed-in browser page showing the item to remove.
 * @param kind - Item type: `location`, `boulder` or `problem`.
 */
export async function deleteItem(page: Page, kind: string) {
  // Open the removal confirmation for the current item.
  await page.getByRole('button', { name: 'Remove ' + kind, exact: true }).click();
  // Confirm deletion and verify it was accepted.
  await submit(page, 'Remove ' + kind);
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
 * Run cleanup without replacing the test result if cleanup fails.
 * Failures are logged and added to the test report as cleanup warning annotations.
 * @param page - Signed-in browser page used for cleanup requests.
 * @param prefix - Stable test-specific location prefix to remove across runs.
 * @param info - Playwright test information receiving any cleanup warning.
 */
export async function deleteLocationsWithPrefix(page: Page, prefix: string, info: TestInfo) {
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
