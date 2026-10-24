import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { locationName } from './testHelpers';
import { guide } from './apiTestHelpers';
import { testUser, openPage, seedLocation, editGuide } from './seedHelpers';

const prefix = 'test_coords_loc_';
const user = testUser('test_coords_user_', prefix);

/**
 * Open the Create location dialog from Explore.
 * @returns The page, dialog, the dialog's map and its coordinate inputs.
 */
async function openCreateDialog() {
  const page = await user.current.context.newPage();
  await page.goto('/#explore');
  await page.getByRole('button', { name: /Create location/ }).click();
  return pickerIn(page, 'Create a location');
}

/**
 * Find the coordinate picker in the open dialog and wait for its map.
 * @param page - Page with the dialog open.
 * @param title - Expected dialog heading.
 */
async function pickerIn(page: Page, title: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const map = dialog.locator('.coordinate-map');
  await expect(map.locator('.leaflet-tile-pane')).toBeAttached();
  return {
    page,
    dialog,
    map,
    latitude: dialog.getByLabel('Latitude'),
    longitude: dialog.getByLabel('Longitude'),
    marker: map.locator('.leaflet-marker-icon[title="Selected location"]'),
  };
}

/** Pixel distance between the centres of two elements. */
async function distance(a: Locator, b: Locator) {
  const [x, y] = [await a.boundingBox(), await b.boundingBox()];
  return Math.hypot(x!.x + x!.width / 2 - (y!.x + y!.width / 2), x!.y + x!.height / 2 - (y!.y + y!.height / 2));
}

/** Click a point on the map, offset in pixels from its centre. */
async function clickMap(page: Page, map: Locator, dx = 0, dy = 0) {
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test('clicking the map fills in the coordinates', async () => {
  const { page, map, latitude, longitude, marker } = await openCreateDialog();
  await expect(marker).toHaveCount(0);
  // The picker opens centred on 20°N, 0°E, so clicking the centre picks about that point.
  await clickMap(page, map);
  await expect(latitude).toHaveValue(/^-?\d+\.\d{6}$/);
  await expect(longitude).toHaveValue(/^-?\d+\.\d{6}$/);
  expect(Math.abs(Number(await latitude.inputValue()) - 20), 'Latitude is near the map centre').toBeLessThan(1.5);
  expect(Math.abs(Number(await longitude.inputValue())), 'Longitude is near the map centre').toBeLessThan(1.5);
  await expect(marker).toBeVisible();
  // Clicking further east increases the longitude and moves the marker there.
  const before = Number(await longitude.inputValue());
  await clickMap(page, map, 100, 0);
  await expect
    .poll(async () => Number(await longitude.inputValue()), { message: 'Longitude moved east' })
    .toBeGreaterThan(before + 5);
});

test('typed coordinates place the marker, which follows later changes', async () => {
  const { map, latitude, longitude, marker } = await openCreateDialog();
  // The first valid pair centres the map on the marker.
  await latitude.fill('51.5');
  await longitude.fill('-0.12');
  await expect(marker).toBeVisible();
  await expect.poll(() => distance(marker, map), { message: 'Marker is centred' }).toBeLessThan(3);
  // A new pair pans the map to the new point.
  await latitude.fill('51.52');
  await expect.poll(() => distance(marker, map), { message: 'Marker is centred again after panning' }).toBeLessThan(3);
});

test('invalid coordinates remove the marker and cannot be saved', async () => {
  const { page, dialog, latitude, longitude, marker } = await openCreateDialog();
  await dialog.getByLabel(/^Location name/).fill(locationName(prefix));
  await dialog.getByLabel(/^Approach notes/).fill('Never saved.');
  await latitude.fill('51.5');
  await longitude.fill('-0.12');
  await expect(marker).toBeVisible();
  let saves = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/guide') && request.method() === 'PUT') saves++;
  });
  // Out-of-range and missing coordinates each remove the marker and block saving.
  for (const [field, value] of [
    [latitude, '91'],
    [longitude, '-181'],
    [longitude, ''],
  ] as const) {
    await latitude.fill('51.5');
    await longitude.fill('-0.12');
    await expect(marker).toBeVisible();
    await field.fill(value);
    await expect(marker).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
    expect(
      await field.evaluate((input: HTMLInputElement) => input.validity.valid),
      `${value || 'blank'} is invalid`
    ).toBe(false);
    await expect(dialog).toBeVisible();
  }
  expect(saves, 'No guide save was sent').toBe(0);
});

test('a new location shows its coordinates, a maps link and a map marker', async () => {
  const { page, dialog, latitude, longitude } = await openCreateDialog();
  const name = locationName(prefix);
  await dialog.getByLabel(/^Location name/).fill(name);
  await latitude.fill('51.5');
  await longitude.fill('-0.12');
  await dialog.getByLabel(/^Approach notes/).fill('Walk from the station.');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
  expect((await saved).status(), 'Location saved').toBe(200);
  // The location page shows the coordinates to 5 places and links them to Google Maps.
  await expect(page.locator('.detail-banner').getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.locator('.coordinates')).toHaveText('51.50000, -0.12000');
  await expect(page.getByRole('link', { name: 'Open in maps ↗' })).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=51.5%2C-0.12'
  );
  // API/DB check: the coordinates were saved as entered.
  expect(
    (await guide(page)).locations.find((l: any) => l.name === name),
    'API/DB: coordinates saved'
  ).toMatchObject({ latitude: '51.5', longitude: '-0.12' });
  // Explore shows a marker for it.
  await page.goto('/#explore');
  await page.reload();
  await expect(page.locator(`.location-map-section .leaflet-marker-icon[title="${name}"]`)).toBeAttached();
});

test('editing a location starts the map at its saved point and saves a new one', async () => {
  const { location } = await seedLocation(user.current.request, prefix, {
    media: false,
    latitude: '56.8',
    longitude: '-3.2',
  });
  const page = await openPage(user.current.context, { location: location.id }, location.name);
  await page.getByRole('button', { name: /^Edit location/ }).click();
  const { dialog, map, latitude, longitude, marker } = await pickerIn(page, 'Edit location');
  // The saved coordinates are filled in and the map is centred on them.
  await expect(latitude).toHaveValue('56.8');
  await expect(longitude).toHaveValue('-3.2');
  await expect(marker).toBeVisible();
  await expect.poll(() => distance(marker, map), { message: 'Marker starts centred' }).toBeLessThan(3);
  // Pick a point to the north-east on the map and save it.
  await clickMap(page, map, 60, -40);
  await expect
    .poll(async () => Number(await longitude.inputValue()), { message: 'Longitude moved east' })
    .toBeGreaterThan(-3.2);
  expect(Number(await latitude.inputValue()), 'Latitude moved north').toBeGreaterThan(56.8);
  const [lat, lng] = [await latitude.inputValue(), await longitude.inputValue()];
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
  expect((await saved).status(), 'Location saved').toBe(200);
  // The page and the API both show the picked point.
  await expect(page.locator('.coordinates')).toHaveText(`${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`);
  const savedLocation = (await guide(page)).locations.find((l: any) => l.id === location.id);
  expect(Number(savedLocation.latitude), 'API/DB: latitude saved').toBeCloseTo(Number(lat), 6);
  expect(Number(savedLocation.longitude), 'API/DB: longitude saved').toBeCloseTo(Number(lng), 6);
});

test('coordinates at the exact limits save, and just past them are refused', async () => {
  const { dialog, latitude, longitude, page } = await openCreateDialog();
  const name = locationName(prefix);
  await dialog.getByLabel(/^Location name/).fill(name);
  await dialog.getByLabel(/^Approach notes/).fill('At the edge of the map.');
  let saves = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/guide') && request.method() === 'PUT') saves++;
  });
  // Just past each limit is refused by the browser, and nothing is sent.
  for (const [field, value] of [
    [latitude, '90.000001'],
    [latitude, '-90.000001'],
    [longitude, '180.000001'],
    [longitude, '-180.000001'],
  ] as const) {
    await latitude.fill('0');
    await longitude.fill('0');
    await field.fill(value);
    await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
    expect(await field.evaluate((input: HTMLInputElement) => input.validity.valid), value + ' is refused').toBe(false);
  }
  expect(saves, 'No guide save was sent').toBe(0);
  // The exact limits are valid and save.
  await latitude.fill('-90');
  await longitude.fill('180');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
  expect((await saved).status(), 'Boundary coordinates saved').toBe(200);
  await expect(page.locator('.coordinates')).toHaveText('-90.00000, 180.00000');
  // API check: the server refuses values past the limits from any client.
  const response = await editGuide(user.current.request, g => {
    g.locations.find((l: any) => l.name === name).latitude = '90.000001';
  });
  expect(response.status(), 'API: latitude past 90 refused').toBe(400);
});
