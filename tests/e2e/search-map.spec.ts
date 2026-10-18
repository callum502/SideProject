import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';
import { testUser, signIn, seedLocation } from './seedHelpers';

// Two locations share a random token, so searches match only this run's data even with other workers creating locations.
const prefix = 'test_search_loc_';
const user = testUser('test_search_user_', prefix);
const token = randomUUID().slice(0, 8);
let alpha: any, beta: any;

test.beforeAll(async () => {
  // Distinct coordinates keep these markers apart from other tests' locations.
  alpha = (await seedLocation(user.current.request, prefix, { media: false, name: `${prefix}${token}_Alpha_Crag`, latitude: '-33.9', longitude: '18.4' })).location;
  beta = (await seedLocation(user.current.request, prefix, { media: false, name: `${prefix}${token}_Beta_Crag`, latitude: '-41.3', longitude: '174.8' })).location;
});

/**
 * Open the Explore page and wait for the guide to load.
 * @returns The page and its search input.
 */
async function explore(context = user.current.context) {
  const page = await context.newPage();
  await page.goto('/#explore');
  const search = page.getByLabel('Find a location', { exact: true });
  await expect(search).toBeVisible();
  return { page, search };
}

test('search filters locations by name, ignoring case and surrounding spaces', async () => {
  const { page, search } = await explore();
  const results = page.locator('.location-result strong');
  // Both locations match the shared token.
  await search.fill(token);
  await expect(results).toHaveText([alpha.name, beta.name]);
  // Matching ignores case and surrounding spaces.
  await search.fill(`  ${token}_ALPHA  `);
  await expect(results).toHaveText([alpha.name]);
  // A search with no matches says so.
  await search.fill(token + '_no_such_crag');
  await expect(results).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Find a climbing location' }).getByRole('status')).toHaveText('No matching locations.');
});

test('a search result opens its location', async () => {
  const { page, search } = await explore();
  await search.fill(`${token}_Beta`);
  await page.getByRole('link', { name: beta.name }).click();
  // Verify the location page opened for the chosen result.
  await expect(page).toHaveURL(new RegExp('#location=' + beta.id + '$'));
  await expect(page.locator('.detail-banner').getByRole('heading', { name: beta.name, exact: true })).toBeVisible();
});

test('search results can be browsed with the keyboard', async () => {
  const { page, search } = await explore();
  const results = page.locator('.location-result');
  await search.fill(token);
  await expect(results).toHaveCount(2);
  // Arrow keys move through the results and wrap at either end.
  await search.press('ArrowDown');
  await expect(results.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(results.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(results.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(results.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(results.nth(0)).toBeFocused();
  // Enter on a focused result opens it.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp('#location=' + alpha.id + '$'));
});

// Regression: returning focus to the search box used to reopen the results through onFocus, and Chrome's
// native Escape cleared the query, whose onChange reopened them with every location.
test('Escape closes the results, from a focused result or the search box, keeping the search', async () => {
  const { page, search } = await explore();
  const results = page.locator('.location-result');
  await search.fill(token);
  // From a focused result: the results close and focus returns to the search box.
  await search.press('ArrowDown');
  await expect(results.nth(0)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(results).toHaveCount(0, { timeout: 3000 });
  await expect(search).toHaveValue(token);
  // From the search box: the results close and the search text stays.
  await search.press('ArrowDown');
  await expect(results).toHaveCount(2);
  await search.press('Escape');
  await expect(results).toHaveCount(0, { timeout: 3000 });
  await expect(search).toHaveValue(token);
  // Clicking back into the search box reopens them.
  await search.blur();
  await search.click();
  await expect(results).toHaveCount(2);
});

test('Create location is offered only to signed-in users', async ({ browser }) => {
  // A guest is not offered location creation.
  const guest = await signIn(browser);
  try {
    const { page } = await explore(guest.context);
    await expect(page.getByRole('button', { name: /Create location/ })).toHaveCount(0);
  } finally { await guest.context.close(); }
  // A signed-in user is, and it opens the creation form.
  const { page } = await explore();
  await page.getByRole('button', { name: /Create location/ }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Create a location', exact: true })).toBeVisible();
});

test('the map shows a marker for every mapped location and opens a location from its marker', async () => {
  const { page } = await explore();
  const markers = page.locator('.location-map-section .leaflet-marker-icon');
  const marker = markers.and(page.locator(`[title="${alpha.name}"]`));
  await expect(marker).toBeVisible();
  // The mapped count matches the markers drawn on the map.
  const count = Number((await page.locator('.location-map-section .count').innerText()).replace(' mapped', ''));
  expect(count, 'Mapped count is a number').toBeGreaterThanOrEqual(2);
  await expect(markers).toHaveCount(count);
  // Clicking a marker opens its location. Markers from other tests can overlap, so dispatch the click to this one.
  await marker.dispatchEvent('click');
  await expect(page).toHaveURL(new RegExp('#location=' + alpha.id + '$'));
  await expect(page.locator('.detail-banner').getByRole('heading', { name: alpha.name, exact: true })).toBeVisible();
});

test('the map explains when its tiles cannot load', async () => {
  const page = await user.current.context.newPage();
  // Page routes take precedence over the context's blank tiles.
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('/#explore');
  await expect(page.getByText('Map tiles could not load. Check your connection; you can still select locations using the search above.', { exact: true })).toBeVisible();
});
