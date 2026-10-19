import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation } from './seedHelpers';

// Network and server failures are simulated by intercepting the app's own requests to its API.
const prefix = 'test_failures_loc_';
const user = testUser('test_failures_user_', prefix);
const isSave = (method: string) => method === 'PUT';

/** Open a seeded location's Edit dialog with a new name typed in. */
async function editLocationName() {
  const { location } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id }, location.name);
  await page.getByRole('button', { name: /^Edit location/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Location name/).fill(location.name + '_edited');
  return { page, dialog, location };
}

/** Make the next guide save fail with the given handler. */
const failNextSave = (page: Page, handler: (route: any) => Promise<void>) =>
  page.route('**/api/guide', route => isSave(route.request().method()) ? handler(route) : route.fallback(), { times: 1 });

test('a failed save keeps the dialog and what was typed, and can be retried', async () => {
  const { page, dialog, location } = await editLocationName();
  await failNextSave(page, route => route.abort('connectionreset'));
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel(/^Location name/)).toHaveValue(location.name + '_edited');
  expect(find(await guide(page), location.id).name, 'API/DB: nothing saved').toBe(location.name);
  // Retrying once the connection is back saves it.
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && isSave(r.request().method()));
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
  expect((await saved).status(), 'Retry saved').toBe(200);
  await expect(page.locator('.detail-banner').getByRole('heading', { name: location.name + '_edited', exact: true })).toBeVisible();
});

test("the server's own error messages are shown, such as being rate limited", async () => {
  const { page, dialog } = await editLocationName();
  await failNextSave(page, route => route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { error: 'Too many requests. Please wait before trying again.' } }));
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Too many requests. Please wait before trying again.');
});

test('a guide that fails to load shows an error instead of an empty page', async () => {
  const page = await user.current.context.newPage();
  await page.route('**/api/guide', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, json: { error: 'Database is unavailable. Your changes were not confirmed; reload before retrying.' } })
    : route.fallback());
  await page.goto('/#explore');
  await expect(page.getByRole('alert')).toContainText('Database is unavailable.');
});

// Regression: these used to show the browser's raw "Failed to fetch", or a JSON parse error for an HTML error page
// (such as a proxy's 502 while the server restarts).
test('network failures and non-JSON error pages get a readable message', async () => {
  const { page, dialog, location } = await editLocationName();
  const html = (status: number) => (route: any) => route.fulfill({ status, contentType: 'text/html', body: `<html><body>${status}</body></html>` });
  for (const [what, handler, message] of [
    ['a dropped connection', (route: any) => route.abort('connectionreset'), "Couldn't reach SideProj. Check your connection and try again."],
    ['an HTML server error page', html(502), 'SideProj is having trouble right now. Please try again in a moment.'],
    ['an HTML client error page', html(404), 'Something went wrong. Please try again.'],
  ] as const) {
    await test.step(what, async () => {
      await failNextSave(page, handler);
      await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText(message);
      // The dialog keeps what was typed, so the save can be retried.
      await expect(dialog.getByLabel(/^Location name/)).toHaveValue(location.name + '_edited');
    });
  }
});
