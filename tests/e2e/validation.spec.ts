import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation, editGuide } from './seedHelpers';

// Required fields: the browser blocks empty ones with its own message, so the tests check the field is invalid
// and nothing was saved. Input of only spaces passes the browser's check, so the app must catch it with a message.
const prefix = 'test_valid_loc_';
const user = testUser('test_valid_user_', prefix);

/** Count guide saves sent by the page from now on. */
function countSaves(page: Page) {
  const saves = { count: 0 };
  page.on('request', request => { if (request.url().endsWith('/api/guide') && request.method() === 'PUT') saves.count++; });
  return saves;
}

/** Submit the dialog and verify the browser refused the empty required field, sending nothing. */
async function expectMissing(page: Page, field: Locator, submit: string, saves: { count: number }) {
  await page.getByRole('dialog').getByRole('button', { name: submit, exact: true }).click();
  expect(await field.evaluate((input: HTMLInputElement) => input.validity.valueMissing), 'Field is reported as missing').toBe(true);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(saves.count, 'Nothing was saved').toBe(0);
}

test('the location form requires a name, coordinates and approach notes', async () => {
  const page = await user.current.context.newPage();
  await page.goto('/#explore');
  await page.getByRole('button', { name: /Create location/ }).click();
  const dialog = page.getByRole('dialog');
  const fields = { name: dialog.getByLabel(/^Location name/), latitude: dialog.getByLabel('Latitude'), longitude: dialog.getByLabel('Longitude'), approach: dialog.getByLabel(/^Approach notes/) };
  const valid = { name: prefix + 'never_saved', latitude: '56.8', longitude: '-3.2', approach: 'Never saved.' };
  const saves = countSaves(page);
  // Each required field left empty blocks the save.
  for (const empty of Object.keys(fields) as (keyof typeof fields)[]) {
    await test.step(`empty ${empty}`, async () => {
      for (const [key, field] of Object.entries(fields)) await field.fill(key === empty ? '' : valid[key as keyof typeof valid]);
      await expectMissing(page, fields[empty], 'Save location', saves);
    });
  }
  // Only spaces in the name or approach notes get the app's message.
  for (const [field, message] of [['name', 'Please enter a name.'], ['approach', 'Approach notes are required.']] as const) {
    await test.step(`${field} of only spaces`, async () => {
      for (const [key, input] of Object.entries(fields)) await input.fill(key === field ? '   ' : valid[key as keyof typeof valid]);
      await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText(message);
      expect(saves.count, 'Nothing was saved').toBe(0);
    });
  }
});

test('the boulder form requires a name and directions', async () => {
  const { location } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id }, location.name);
  await page.getByRole('button', { name: /Add boulder/ }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel(/^Boulder name/), notes = dialog.getByLabel(/^Finding the Boulder/);
  const saves = countSaves(page);
  await notes.fill('Beside the path.');
  await expectMissing(page, name, 'Save boulder', saves);
  await name.fill('Valid boulder');
  await notes.fill('');
  await expectMissing(page, notes, 'Save boulder', saves);
  // Only spaces get the app's message.
  await notes.fill('   ');
  await dialog.getByRole('button', { name: 'Save boulder', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Finding the Boulder is required.');
  await notes.fill('Beside the path.');
  await name.fill('   ');
  await dialog.getByRole('button', { name: 'Save boulder', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Please enter a name.');
  expect(saves.count, 'Nothing was saved').toBe(0);
});

// Regression: a name or description of only spaces used to just move focus to the field, with no message.
test('the problem form requires a name, grade and description, and explains what is missing', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  await page.getByRole('button', { name: /Add problem/ }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel(/^Problem name/), grade = dialog.getByLabel(/^Grade/), description = dialog.getByLabel(/^Description/);
  const saves = countSaves(page);
  await test.step('empty fields', async () => {
    await description.fill('Climb it.');
    await grade.selectOption('V1 (5)');
    await expectMissing(page, name, 'Save problem', saves);
    await name.fill('Valid problem');
    await description.fill('');
    await expectMissing(page, description, 'Save problem', saves);
    await description.fill('Climb it.');
    await grade.selectOption('');
    await expectMissing(page, grade, 'Save problem', saves);
  });
  for (const [field, input, message] of [['name', name, 'Please enter a name.'], ['description', description, 'Description is required.']] as const) {
    await test.step(`${field} of only spaces`, async () => {
      await name.fill('Valid problem');
      await grade.selectOption('V1 (5)');
      await description.fill('Climb it.');
      await input.fill('   ');
      await dialog.getByRole('button', { name: 'Save problem', exact: true }).click();
      expect(saves.count, 'Nothing was saved').toBe(0);
      await expect(dialog.getByRole('alert'), 'A message says what is missing').toHaveText(message);
      await expect(input, 'The missing field has focus').toBeFocused();
    });
  }
  await test.step('valid after a refusal', async () => {
    // Fixing the field saves the problem and closes the form.
    await description.fill('Climb it.');
    const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Save problem', exact: true }).click();
    expect((await saved).status(), 'Problem saved').toBe(200);
    await expect(dialog).toHaveCount(0);
  });
});

test('form fields stop accepting text at their length limits', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  const dialog = page.getByRole('dialog');
  /** Fill the field to its limit, then type one more key: the field must keep exactly the limit. */
  async function capped(field: Locator, limit: number) {
    await field.fill('x'.repeat(limit));
    await field.press('End');
    await field.press('y');
    expect((await field.inputValue()).length, 'Capped at ' + limit).toBe(limit);
  }
  await page.getByRole('button', { name: 'Edit boulder', exact: true }).click();
  await capped(dialog.getByLabel(/^Boulder name/), 80);
  await capped(dialog.getByLabel(/^Finding the Boulder/), 800);
  await capped(dialog.getByLabel(/^Other Notes/), 800);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /Add problem/ }).click();
  await capped(dialog.getByLabel(/^Problem name/), 80);
  await capped(dialog.getByLabel(/^Description/), 800);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: new RegExp(location.name) }).first().click();
  await page.getByRole('button', { name: /^Edit location/ }).click();
  await capped(dialog.getByLabel(/^Location name/), 80);
});

test('names containing HTML are shown as text and never run as code', async () => {
  // Each name tries to run script if it were inserted as HTML.
  const payload = (tag: string) => `<img src=x onerror="window.__xss='${tag}'">`;
  const { location, boulder, problem } = await seedLocation(user.current.request, prefix, { media: false, name: prefix + payload('location') });
  expect((await editGuide(user.current.request, g => { find(g, boulder.id).name = payload('boulder'); find(g, problem.id).name = payload('problem'); })).status(), 'Names saved').toBe(200);
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id, problem: problem.id }, 'V2 (5+) - ' + payload('problem'));
  const ran = () => page.evaluate(() => (window as any).__xss);
  // Problem page and breadcrumbs.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(payload('boulder'));
  // Location page and its boulder list.
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: /^Location/ }).click();
  await expect(page.locator('.detail-banner').getByRole('heading', { name: prefix + payload('location'), exact: true })).toBeVisible();
  // Search results and the map.
  await page.goto('/#explore');
  await page.getByLabel('Find a location', { exact: true }).fill(payload('location').slice(0, 12));
  await expect(page.locator('.location-result').filter({ hasText: payload('location') })).toBeVisible();
  await page.locator('.location-map-section .leaflet-marker-icon').and(page.getByTitle(prefix + payload('location'), { exact: true })).hover();
  // Check no payload ran on any of these pages.
  expect(await ran(), 'No script ran').toBeUndefined();
  expect(await page.locator('img[src="x"]').count(), 'No injected image elements').toBe(0);
});
