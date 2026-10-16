import { expect, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const testPrefix = (kind: string) => 'test_' + kind + '_' + randomUUID().slice(0, 8) + '_';
export const locationName = (prefix: string) => prefix + Date.now() + '_' + randomUUID().slice(0, 6);
export async function login(page: Page) {
  const { E2E_EMAIL: email, E2E_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error('Set E2E_EMAIL and E2E_PASSWORD in .env.local.');
  await page.goto('/#login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/#explore$/);
  await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible();
}
export async function guide(page: Page) {
  const response = await page.request.get('/api/guide', { timeout: 10000 });
  if (!response.ok()) throw new Error('Reading test guide failed: HTTP ' + response.status());
  return response.json();
}
export async function navigate(page: Page, location?: string, boulder?: string, problem?: string) {
  const params = new URLSearchParams();
  if (location) params.set('location', location);
  if (boulder) params.set('boulder', boulder);
  if (problem) params.set('problem', problem);
  await page.goto('/#' + (location ? params.toString() : 'explore'));
  // Hash navigation alone keeps the previous guide revision after API cleanup.
  if (!location) await page.reload();
  await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible();
  if (location) await expect(page.locator('.detail-banner')).toBeVisible();
  else await expect(page.getByRole('button', { name: /Create location/ })).toBeEnabled();
}
async function submit(page: Page, label: string) {
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  const response = await saved;
  expect(response.status(), 'Guide write succeeded').toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function fill(page: Page, fields: Record<string, string>) {
  for (const [name, value] of Object.entries(fields)) {
    const input = page.getByRole('dialog').locator('[name="' + name + '"]');
    if (name === 'grade') await input.selectOption(value);
    else await input.fill(value);
  }
}
export async function createLocation(page: Page, prefix: string) {
  await navigate(page);
  await page.getByRole('button', { name: /Create location/ }).click();
  const fields = { name: locationName(prefix), latitude: '56.8', longitude: '-3.2', approach: 'Follow the test path from the parking area.' };
  await fill(page, fields);
  await submit(page, 'Save location');
  await expect(page.getByRole('heading', { name: fields.name, exact: true })).toBeVisible();
  const location = (await guide(page)).locations.find((item: any) => item.name === fields.name);
  expect(location).toMatchObject(fields);
  return location;
}
export async function createBoulder(page: Page, location: any) {
  await navigate(page, location.id);
  await page.getByRole('button', { name: /Add boulder/ }).click();
  const fields = { name: 'Test Boulder', notes: 'Walk ten metres past the gate.', otherNotes: 'Granite with a flat landing.' };
  await fill(page, fields);
  await submit(page, 'Save boulder');
  await expect(page.getByRole('heading', { name: fields.name, exact: true })).toBeVisible();
  const boulder = (await guide(page)).locations.find((l: any) => l.id === location.id).boulders.find((b: any) => b.name === fields.name);
  expect(boulder).toMatchObject(fields);
  return boulder;
}
export async function createProblem(page: Page, location: any, boulder: any) {
  await navigate(page, location.id, boulder.id);
  await page.getByRole('button', { name: /Add problem/ }).click();
  const fields = { name: 'Test Problem', grade: 'V1 (5)', description: 'Start on the low holds and climb straight up.' };
  await fill(page, fields);
  await submit(page, 'Save problem');
  const problem = (await guide(page)).locations.find((l: any) => l.id === location.id).boulders.find((b: any) => b.id === boulder.id).problems.find((p: any) => p.name === fields.name);
  expect(problem).toMatchObject(fields);
  await navigate(page, location.id, boulder.id, problem.id);
  await expect(page.getByRole('heading', { name: fields.grade + ' - ' + fields.name, exact: true })).toBeVisible();
  return problem;
}
export async function editItem(page: Page, kind: string, fields: Record<string, string>) {
  await page.getByRole('button', { name: new RegExp('^Edit ' + kind) }).click();
  await fill(page, fields);
  await submit(page, 'Save ' + kind);
  await page.reload();
  await expect(page.locator('.detail-banner')).toContainText(fields.name);
}
export async function deleteItem(page: Page, kind: string) {
  await page.getByRole('button', { name: 'Remove ' + kind, exact: true }).click();
  await submit(page, 'Remove ' + kind);
}
// No assertions here: cleanup errors are reported but must not replace the test result.
export async function cleanup(page: Page, prefix: string) {
  if (!prefix.startsWith('test_') || prefix.length <= 5) throw new Error('Cleanup requires a scoped test_ prefix.');
  const current = await guide(page);
  const locations = current.locations.filter((l: any) => !l.name.startsWith(prefix));
  if (locations.length === current.locations.length) return;
  const response = await page.request.put('/api/guide', { data: { ...current, locations }, timeout: 10000 });
  if (!response.ok()) throw new Error('Cleanup failed: HTTP ' + response.status());
}
export async function deleteLocationsWithPrefix(page: Page, prefix: string, info: TestInfo) {
  try { await cleanup(page, prefix); }
  catch (error) {
    const warning = 'Cleanup warning for ' + prefix + ': ' + String(error);
    console.warn(warning);
    info.annotations.push({ type: 'cleanup warning', description: warning });
  }
}
