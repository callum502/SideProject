import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation } from './seedHelpers';
import { mediaFile } from './media';

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
  page.route('**/api/guide', route => (isSave(route.request().method()) ? handler(route) : route.fallback()), {
    times: 1,
  });

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
  await expect(
    page.locator('.detail-banner').getByRole('heading', { name: location.name + '_edited', exact: true })
  ).toBeVisible();
});

test("the server's own error messages are shown, such as being rate limited", async () => {
  const { page, dialog } = await editLocationName();
  await failNextSave(page, route =>
    route.fulfill({
      status: 429,
      headers: { 'Retry-After': '60' },
      json: { error: 'Too many requests. Please wait before trying again.' },
    })
  );
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Too many requests. Please wait before trying again.');
});

test('a guide that fails to load shows an error instead of an empty page', async () => {
  const page = await user.current.context.newPage();
  await page.route('**/api/guide', route =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 503,
          json: { error: 'Database is unavailable. Your changes were not confirmed; reload before retrying.' },
        })
      : route.fallback()
  );
  await page.goto('/#explore');
  await expect(page.getByRole('alert')).toContainText('Database is unavailable.');
});

// Regression: these used to show the browser's raw "Failed to fetch", or a JSON parse error for an HTML error page
// (such as a proxy's 502 while the server restarts).
test('network failures and non-JSON error pages get a readable message', async () => {
  const { page, dialog, location } = await editLocationName();
  const html = (status: number) => (route: any) =>
    route.fulfill({ status, contentType: 'text/html', body: `<html><body>${status}</body></html>` });
  for (const [what, handler, message] of [
    [
      'a dropped connection',
      (route: any) => route.abort('connectionreset'),
      "Couldn't reach SideProj. Check your connection and try again.",
    ],
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

// Regression: these screens used to make their own fetch calls, so a dropped connection showed the browser's raw
// "Failed to fetch". Every screen now uses the shared api() in src/api.js.
const offline = "Couldn't reach SideProj. Check your connection and try again.";
const dropConnection = (page: Page, path: string, when: (body: string) => boolean = () => true) =>
  page.route('**' + path, route =>
    when(route.request().postData() || '') ? route.abort('connectionreset') : route.fallback()
  );

test('a dropped connection while logging in gets a readable message', async ({ browser }) => {
  const guest = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const page = await guest.newPage();
    await page.goto('/#login');
    await dropConnection(page, '/api/login');
    await page.locator('input[name="email"]').fill('someone@example.com');
    await page.locator('input[name="password"]').fill('pw-anything');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(offline);
  } finally {
    await guest.close();
  }
});

test('a dropped connection while saving the profile gets a readable message', async () => {
  const page = await user.current.context.newPage();
  await page.goto('/#details');
  await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
  await dropConnection(page, '/api/profile');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(offline);
});

test('a dropped connection while inviting a friend gets a readable message', async () => {
  const page = await user.current.context.newPage();
  await page.goto('/#friends');
  await expect(page.getByRole('heading', { level: 1, name: 'Friends', exact: true })).toBeVisible();
  // Only the invite fails; the live name suggestions still work.
  await dropConnection(page, '/api/friends', body => /"action":"(search|request)"/.test(body));
  await page.getByLabel('Display name').fill('test_failures_nobody');
  await page.getByRole('button', { name: 'Send invite', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Couldn|Failed to fetch/ })).toHaveText(offline);
});

test('a dropped connection while uploading a profile photo gets a readable message', async () => {
  const page = await user.current.context.newPage();
  await page.goto('/#user=' + user.current.account.id);
  await expect(page.getByRole('heading', { level: 1, name: user.current.account.name, exact: true })).toBeVisible();
  await dropConnection(page, '/api/images');
  await page
    .locator('label', { hasText: 'Upload profile photo' })
    .locator('input[type="file"]')
    .setInputFiles([mediaFile('png')]);
  await expect(page.getByRole('alert')).toHaveText(offline);
});
