/*
 * UI helper quick reference
 * API/DB reads, assertions and cleanup are in apiTestHelpers.ts.
 *
 * locationName              Generate a unique name with a stable cleanup prefix.
 * login                     Sign in through the UI and verify success; defaults to the E2E account.
 * navigate                  Open Explore or a location, boulder or problem page.
 * createLocation            Create and verify a location; return its saved record.
 * createBoulder             Create and verify a boulder; return its saved record.
 * createProblem             Create and verify a problem; return its saved record.
 * editItem                  Edit the current item and verify its saved heading.
 * deleteItem                Confirm removal of the current item.
 * accountDetails            Generate unique sign-up values with a stable cleanup prefix.
 * createAccount             Sign up, confirm with E2E_CONFIRM_CODE and log in; return the account.
 * openProfile               Open the signed-in user's profile page from the account menu.
 * editProfile               Edit display name, height and ape index from the profile page.
 * deleteAccount             Delete the signed-in account through its confirmation dialog.
 * chooseFiles               Choose files in an upload control identified by its visible label.
 * completeUpload            Name the chosen files in the upload dialog, upload them and verify the save.
 * dialogError               Submit the active dialog and verify it shows an error without saving.
 *
 * Internal helpers
 * submit                    Submit a dialog and verify the save response.
 * fill                      Populate the active dialog's fields.
 * fillProfile               Populate the sign-up or Your profile form.
 */

import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { guide, sessionUser, type ProfileFormFields } from './apiTestHelpers';

/**
 * Build a unique location name while retaining a stable cleanup prefix.
 * @param prefix - Test-specific prefix, such as `test_problem_`.
 * @returns The prefix followed by a timestamp and random suffix.
 */
export const locationName = (prefix: string) => prefix + Date.now() + '_' + randomUUID().slice(0, 6);

/**
 * Log in through the UI and verify the signed-in page.
 * @param page - Browser page to sign in on.
 * @param credentials - Email and password to use; defaults to E2E_EMAIL and E2E_PASSWORD.
 * @throws If credentials are missing or login assertions fail.
 */
export async function login(page: Page, credentials?: { email: string, password: string }) {
  // Read credentials without embedding them in test source.
  const { email, password } = credentials || { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
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
  // Hash navigation alone keeps showing locations removed by API cleanup.
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
 * Build unique sign-up values while retaining a stable cleanup prefix.
 * The prefix starts both the email and display name so cleanup can find leftovers from earlier runs.
 * @param prefix - Test-specific prefix, such as `test_account_`.
 * @returns Email, password and profile form values for a new account.
 */
export function accountDetails(prefix: string) {
  const name = locationName(prefix);
  return { email: name + '@example.com', password: 'pw-' + randomUUID(), name, heightFeet: '5', heightInches: '10', apeIndex: '2' };
}

/**
 * Populate profile fields in the active form.
 * @param page - Browser page showing the sign-up or Your profile form.
 * @param fields - Profile form values to enter.
 */
async function fillProfile(page: Page, fields: ProfileFormFields) {
  // Enter the display name, then choose height and ape index from their dropdowns.
  await page.locator('input[name="name"]').fill(fields.name);
  await page.locator('select[name="heightFeet"]').selectOption(fields.heightFeet);
  await page.locator('select[name="heightInches"]').selectOption(fields.heightInches);
  await page.locator('select[name="apeIndex"]').selectOption(fields.apeIndex);
}

/**
 * Sign up through the UI, confirm the email with E2E_CONFIRM_CODE, then log in.
 * The test server exchanges E2E_CONFIRM_CODE for a real Supabase code; see confirmBypassCode in auth.mjs.
 * @param page - Signed-out browser page.
 * @param prefix - Stable test-specific prefix used for the email, display name and cleanup.
 * @returns The new account's credentials, profile form values and ID.
 */
export async function createAccount(page: Page, prefix: string) {
  const code = process.env.E2E_CONFIRM_CODE;
  if (!code) throw new Error('E2E_CONFIRM_CODE is not set. It is configured in playwright.config.ts.');
  const account = accountDetails(prefix);
  // Open the sign-up form from the login page.
  await page.goto('/#login');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find your community', exact: true })).toBeVisible();
  // Fill the profile, email and password fields.
  await fillProfile(page, account);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  // Submit sign-up and verify the server accepted it.
  const signedUp = page.waitForResponse(r => r.url().endsWith('/api/signup') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  expect((await signedUp).status(), 'Sign-up succeeded').toBe(200);
  // Verify the confirmation screen opened with the email carried over.
  await expect(page.getByRole('heading', { name: 'Check your inbox', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Check your email for a confirmation code.');
  await expect(page.locator('input[name="email"]')).toHaveValue(account.email);
  // Enter the test confirmation code and verify the server accepted it.
  await page.locator('input[name="code"]').fill(code);
  const confirmed = page.waitForResponse(r => r.url().endsWith('/api/confirm') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  expect((await confirmed).status(), 'Email confirmation succeeded').toBe(200);
  // Verify confirmation returns to the login screen.
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Email confirmed. You can now log in.');
  // Log in with the new credentials and read the account ID from the session.
  await login(page, account);
  const user = await sessionUser(page);
  expect(user, 'API/DB: new account is signed in').toMatchObject({ email: account.email });
  return { ...account, id: user.id as string };
}

/**
 * Open the signed-in user's profile page from the account menu and verify its heading.
 * @param page - Signed-in browser page.
 * @param name - Display name expected as the profile heading.
 */
export async function openProfile(page: Page, name: string) {
  // Open the account menu and choose Profile.
  await page.getByRole('button', { name: /^Account menu for / }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  // Verify the profile page loaded for this user.
  await expect(page).toHaveURL(/#user=/);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

/**
 * Edit the signed-in user's profile from their profile page and verify the save.
 * @param page - Signed-in browser page showing the user's own profile.
 * @param fields - Replacement profile form values.
 */
export async function editProfile(page: Page, fields: ProfileFormFields) {
  // Open the profile edit form.
  await page.getByRole('link', { name: 'Edit profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
  // Fill the form with the supplied values.
  await fillProfile(page, fields);
  // Save the form and verify the server accepted it.
  const saved = page.waitForResponse(r => r.url().endsWith('/api/profile') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  expect((await saved).status(), 'Profile save succeeded').toBe(200);
  // Verify saving returns to Explore.
  await expect(page).toHaveURL(/#explore$/);
}

/**
 * Delete the signed-in account through the profile page confirmation dialog.
 * @param page - Signed-in browser page showing the user's own profile.
 */
export async function deleteAccount(page: Page) {
  // Open the deletion confirmation.
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Delete your account?', exact: true })).toBeVisible();
  // Type the confirmation word, submit and verify the server accepted it.
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  const deleted = page.waitForResponse(r => r.url().endsWith('/api/account') && r.request().method() === 'DELETE');
  await dialog.getByRole('button', { name: 'Permanently delete account', exact: true }).click();
  expect((await deleted).status(), 'Account deletion succeeded').toBe(200);
  // Verify deletion signs out to the login page.
  await expect(page).toHaveURL(/#login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
}

/** A file for setInputFiles: a path, or a name, type and contents. */
type FileInput = string | { name: string, mimeType: string, buffer: Buffer };

/**
 * Choose files in an upload control, which opens the naming dialog.
 * @param page - Page showing the upload control.
 * @param label - Visible text of the control's label, such as `+ Upload images`.
 * @param files - Files to choose.
 */
export async function chooseFiles(page: Page, label: string, files: FileInput[]) {
  await page.locator('label', { hasText: label }).locator('input[type="file"]').setInputFiles(files);
}

/**
 * Complete the naming dialog that opens after choosing files, upload, and verify the guide saved.
 * @param page - Page showing the naming dialog.
 * @param options - Replacement names and captions by file position; omitted positions keep their defaults.
 *   Captions are only offered for parking photos.
 */
export async function completeUpload(page: Page, { names = [], captions = [] }: { names?: string[], captions?: string[] } = {}) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /^Name your (photo|video)$/ })).toBeVisible();
  // Rename and caption the files that need it.
  for (const [index, name] of names.entries()) if (name !== undefined) await dialog.getByLabel(new RegExp('^(Photo|Video) ' + (index + 1) + ' name$')).fill(name);
  for (const [index, caption] of captions.entries()) if (caption !== undefined) await dialog.locator('textarea[name="caption"]').nth(index).fill(caption);
  // Upload, then verify the guide save and dialog closure.
  await submit(page, 'Upload');
}

/**
 * Submit the active dialog and verify it shows the error, stays open and saves nothing.
 * @param page - Page showing the dialog.
 * @param label - Exact name of the dialog's submit button.
 * @param message - Expected error text, or a pattern.
 */
export async function dialogError(page: Page, label: string, message: string | RegExp) {
  let saves = 0;
  const count = (request: { url(): string, method(): string }) => { if (request.url().endsWith('/api/guide') && request.method() === 'PUT') saves++; };
  page.on('request', count);
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(message);
  page.off('request', count);
  expect(saves, 'No guide save was sent').toBe(0);
  await expect(page.getByRole('dialog')).toBeVisible();
}
