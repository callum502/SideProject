import { test, expect } from './fixtures';
import type { BrowserContext } from '@playwright/test';
import { testUser, openPage, seedLocation, uploadImage } from './seedHelpers';
import { mediaFile } from './media';

const prefix = 'test_profile_loc_';
const owner = testUser('test_profile_user_', prefix);
const visitor = testUser('test_profile_visitor_', 'test_profile_visitor_loc_');

/** Open a user's profile page and wait for it to load. */
async function openProfile(context: BrowserContext, id: string, name: string) {
  const page = await context.newPage();
  await page.goto('/#user=' + encodeURIComponent(id));
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  return page;
}

/** The status of the user's profile photo endpoint: 302 to the photo, or 404 without one. */
async function photoStatus(id: string) {
  const response = await owner.current.request.get('/api/profile-photo?id=' + id, { maxRedirects: 0 });
  return response.status();
}

test('a profile photo can be uploaded and removed', async () => {
  const { id, name } = owner.current.account;
  const page = await openProfile(owner.current.context, id, name);
  const avatar = page.locator('.avatar-large');
  // Without a photo, the avatar shows the name's initial.
  await expect(avatar).toHaveText(name[0].toUpperCase());
  await expect(page.getByText(/^Uploads: [\d.]+ GB of 10 GB$/)).toBeVisible();
  // Upload one.
  await page.locator('label', { hasText: 'Upload profile photo' }).locator('input[type="file"]').setInputFiles([mediaFile('jpg')]);
  await expect(avatar.locator('img')).toBeVisible();
  expect(await photoStatus(id), 'API: photo served').toBe(302);
  // Remove it.
  await page.getByRole('button', { name: 'Remove profile photo', exact: true }).click();
  await expect(avatar).toHaveText(name[0].toUpperCase());
  expect(await photoStatus(id), 'API: photo removed').toBe(404);
});

test('profile photos must be supported images up to 8 MB', async () => {
  const { id, name } = owner.current.account;
  const page = await openProfile(owner.current.context, id, name);
  const input = page.locator('label', { hasText: 'Upload profile photo' }).locator('input[type="file"]');
  for (const file of [{ name: 'me.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }, { name: 'me.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) }]) {
    await input.setInputFiles([file]);
    await expect(page.getByRole('alert')).toHaveText('Choose a JPEG, PNG or WebP image up to 8 MB.');
  }
  expect(await photoStatus(id), 'API: no photo saved').toBe(404);
});

test("a profile photo must be the user's own upload", async () => {
  // Another user's uploaded image can't be used as your profile photo.
  const theirs = await uploadImage(visitor.current.request);
  const response = await owner.current.request.post('/api/profile-photo', { data: { url: theirs } });
  expect(response.status(), "API: another user's image is refused").toBe(400);
  expect((await response.json()).error).toBe('Choose an image uploaded by your account.');
});

test("a creator link opens their public profile, without the owner's controls", async () => {
  const { location } = await seedLocation(owner.current.request, prefix, { media: false });
  const page = await openPage(visitor.current.context, { location: location.id }, location.name);
  // The location credits its creator, linking to their profile.
  await page.locator('.detail-banner .created-by').getByRole('link', { name: owner.current.account.name }).click();
  await expect(page.getByRole('heading', { level: 1, name: owner.current.account.name, exact: true })).toBeVisible();
  // It shows their details: 178 cm is 5 ft 10 in, and the ape index is +2 in.
  const measurements = page.locator('.profile-measurements');
  await expect(measurements.locator('div', { hasText: 'Height' }).locator('dd')).toHaveText('5 ft 10 In');
  await expect(measurements.locator('div', { hasText: 'Ape index' }).locator('dd')).toHaveText('+2 In');
  // A visitor isn't offered the owner's controls or shown their storage use.
  for (const name of ['Delete account', 'Remove profile photo']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit profile', exact: true })).toHaveCount(0);
  await expect(page.locator('label', { hasText: 'Upload profile photo' })).toHaveCount(0);
  await expect(page.getByText(/^Uploads:/)).toHaveCount(0);
});
