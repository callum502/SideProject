import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation, editGuide, uploadImage, runSql, uuid } from './seedHelpers';

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
  // Its own coordinates keep its map marker clear of other tests' locations.
  const { location, boulder, problem } = await seedLocation(user.current.request, prefix, { media: false, name: prefix + payload('location'), latitude: '-12.5', longitude: '130.8' });
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
  // Open the marker's tooltip directly (markers from other tests can overlap) and check it shows the name as text.
  await page.locator('.location-map-section .leaflet-marker-icon').and(page.getByTitle(prefix + payload('location'), { exact: true })).dispatchEvent('mouseover');
  await expect(page.locator('.leaflet-tooltip')).toHaveText(prefix + payload('location'));
  // Check no payload ran on any of these pages.
  expect(await ran(), 'No script ran').toBeUndefined();
  expect(await page.locator('img[src="x"]').count(), 'No injected image elements').toBe(0);
});

// The forms cap and check these, but the server must refuse them from any client. Each case is checked even if
// another fails. Regression: annotations for a photo that isn't on the boulder used to be stored, because the server
// didn't check photoAnnotations keys.
test('the server refuses invalid content sent directly to the API', async () => {
  const { location, boulder, problem, image, parking } = await seedLocation(user.current.request, prefix);
  const url = await uploadImage(user.current.request);
  const mark = { type: 'box', color: 'green', x: 10, y: 10, x2: 20, y2: 20 };
  const newImage = (name: string, extra = {}) => ({ id: crypto.randomUUID(), name, caption: '', url, annotations: [], ...extra });
  const cases: [string, (g: any) => void, number, string | RegExp][] = [
    ['a photo named like one already on the boulder', g => find(g, boulder.id).images.push(newImage('  SEED PHOTO ')), 400, /already exists on this boulder/],
    ['a media name over 255 characters', g => find(g, boulder.id).images.push(newImage('x'.repeat(256))), 400, 'Enter a valid media name.'],
    ['a boulder photo caption over 2000 characters', g => { find(g, image.id).caption = 'x'.repeat(2001); }, 400, /./],
    ['a parking photo caption over 2000 characters', g => { find(g, parking.id).caption = 'x'.repeat(2001); }, 400, 'Invalid location photo.'],
    ['over 1000 marks on a photo', g => { find(g, image.id).annotations = Array(1001).fill(mark); }, 400, 'Invalid image.'],
    ['over 1000 marks for a problem photo', g => { find(g, problem.id).photoAnnotations = { [image.id]: Array(1001).fill(mark) }; }, 400, 'Invalid annotations.'],
    ['an unknown drawing tool', g => { find(g, problem.id).photoAnnotations = { [image.id]: [{ ...mark, type: 'circle' }] }; }, 400, 'Unknown annotation tool.'],
    ['an unknown colour', g => { find(g, problem.id).photoAnnotations = { [image.id]: [{ ...mark, color: 'blue' }] }; }, 400, 'Unknown annotation colour.'],
    ['marks outside the photo', g => { find(g, problem.id).photoAnnotations = { [image.id]: [{ ...mark, x2: 1001 }] }; }, 400, 'Invalid annotation coordinates.'],
    ["marks for a photo that isn't on the boulder", g => { find(g, problem.id).photoAnnotations = { [crypto.randomUUID()]: [mark] }; }, 400, 'Problem annotations must be for photos on this boulder.'],
    ['a grade over 40 characters', g => { find(g, problem.id).grade = 'x'.repeat(41); }, 400, 'A problem needs a name, grade, and description.'],
    ["attaching another boulder's photo to a problem", g => find(g, location.id).boulders.push({ id: crypto.randomUUID(), name: 'Other boulder', notes: 'Elsewhere.', otherNotes: '', images: [], videos: [],
      problems: [{ id: crypto.randomUUID(), name: 'Borrower', grade: 'V1 (5)', description: 'Uses a photo from elsewhere.', imageIds: [image.id], videoIds: [] }] }), 400, 'Problem attachments must belong to this boulder.'],
    ['a link label over 120 characters', g => { find(g, location.id).links = [{ label: 'x'.repeat(121), url: 'https://example.com' }]; }, 400, 'Links need a label and a valid HTTP or HTTPS URL.'],
  ];
  const before = await guide(user.current.page);
  for (const [what, change, status, message] of cases) {
    const response = await editGuide(user.current.request, change);
    expect.soft(response.status(), what + ': refused').toBe(status);
    if (!response.ok()) expect.soft((await response.json()).error, what + ': message').toMatch(message);
  }
  // API/DB check: nothing was changed by the refused saves.
  expect(find(await guide(user.current.page), location.id), 'API/DB: location unchanged').toEqual(find(before, location.id));
});

// Regression: the shared Modal used to cancel the dialog's Escape, so Escape never closed a dialog.
test('Escape closes a dialog, like its ✕ button, without saving anything', async () => {
  const { location } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id }, location.name);
  const saves = countSaves(page);
  // A form: Escape closes it and discards the change.
  await page.getByRole('button', { name: /^Edit location/ }).click();
  await page.getByRole('dialog').getByLabel(/^Location name/).fill('Never saved');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // A confirmation: Escape closes it without removing anything.
  await page.getByRole('button', { name: 'Remove location', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(saves.count, 'Nothing was saved').toBe(0);
  await expect(page.locator('.detail-banner').getByRole('heading', { name: location.name, exact: true })).toBeVisible();
  // The dialog opens again normally afterwards.
  await page.getByRole('button', { name: /^Edit location/ }).click();
  await expect(page.getByRole('dialog').getByLabel(/^Location name/)).toHaveValue(location.name);
});

// Regression: the location and boulder forms used to close on ✕ even while saving, unlike the other dialogs, so if
// that save then failed, its error was never seen.
test("a dialog can't be closed while it is saving", async () => {
  const { location } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id }, location.name);
  await page.getByRole('button', { name: /^Edit location/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Location name/).fill(location.name + '_saved');
  // Hold the save so the dialog stays busy.
  let release = () => {};
  const held = new Promise<void>(resolve => release = resolve);
  await page.route('**/api/guide', async route => { if (route.request().method() !== 'PUT') return route.fallback(); await held; await route.continue(); });
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
  // While busy the button reads Saving… and is disabled.
  await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  try {
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog, 'Still open while saving').toBeVisible();
  } finally { release(); }
  // Once saved, it closes as normal.
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.detail-banner').getByRole('heading', { name: location.name + '_saved', exact: true })).toBeVisible();
});

test('the Add Photo menu closes with Escape or a click elsewhere', async () => {
  const { location, boulder, problem } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id, problem: problem.id }, 'V2 (5+) - Seed Problem');
  const button = page.getByRole('button', { name: '+ Add Photo' }), menu = page.locator('.photo-dropdown-options');
  await button.click();
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  // Escape closes it and returns focus to the button.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  // So does clicking elsewhere on the page.
  await button.click();
  await expect(menu).toBeVisible();
  await page.locator('.notes-block').first().click();
  await expect(menu).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('annotations already stored for a removed photo do not block other saves', async () => {
  const { boulder, problem } = await seedLocation(user.current.request, prefix);
  // Older data: annotations for a photo that has since gone, written straight to the database.
  const gone = crypto.randomUUID();
  const marks = JSON.stringify({ [gone]: [{ type: 'line', color: 'red', x: 1, y: 1, x2: 50, y2: 50 }] });
  runSql(`UPDATE public.problems SET photo_annotations = '${marks}'::jsonb WHERE id = '${uuid(problem.id)}'`);
  // Unrelated saves still work, including edits to that problem.
  expect((await editGuide(user.current.request, g => { find(g, boulder.id).name = 'Renamed boulder'; })).status(), 'Boulder renamed').toBe(200);
  expect((await editGuide(user.current.request, g => { find(g, problem.id).grade = 'V3 (6A/6A+)'; })).status(), 'Problem edited').toBe(200);
  // A save can drop the old annotations.
  expect((await editGuide(user.current.request, g => { find(g, problem.id).photoAnnotations = {}; })).status(), 'Old annotations removed').toBe(200);
  expect(find(await guide(user.current.page), problem.id).photoAnnotations, 'API/DB: cleaned up').toEqual({});
});
