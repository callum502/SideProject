import { test, expect } from './fixtures';
import { chooseFiles, completeUpload, dialogError } from './testHelpers';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation } from './seedHelpers';
import { mediaFile } from './media';

const prefix = 'test_photos_loc_';
const user = testUser('test_photos_user_', prefix);


test('uploads JPEG, PNG and WebP photos to a boulder with chosen names', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  // Choose three photos at once; each gets a default name, and the first is renamed.
  await chooseFiles(page, '+ Upload images', [mediaFile('jpg'), mediaFile('png'), mediaFile('webp')]);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Photo 1 name')).toHaveValue('Photo 1');
  await expect(dialog.getByLabel('Photo 3 name')).toHaveValue('Photo 3');
  await completeUpload(page, { names: ['Crimp face'] });
  // All three are shown and counted.
  for (const name of ['Crimp face', 'Photo 2', 'Photo 3']) await expect(page.locator('.photo-grid').getByRole('img', { name, exact: true })).toBeVisible();
  await expect(page.locator('.detail-banner .banner-bottom span').first()).toHaveText('1 problem · 3 photos · 0 videos');
  // API/DB check: each was saved, in the chosen order, with its name, type and creator.
  const images = find(await guide(page), boulder.id).images;
  expect(images.map((i: any) => i.name + '.' + i.url.split('.').pop()), 'API/DB: names and file types saved in order').toEqual(['Crimp face.jpg', 'Photo 2.png', 'Photo 3.webp']);
  for (const image of images) expect(image.createdBy, 'API/DB: credited to the uploader').toBe(user.current.account.id);
  // Names are unique per boulder: the next upload's default skips the names in use.
  await chooseFiles(page, '+ Upload images', [mediaFile('png')]);
  await expect(dialog.getByLabel('Photo 1 name')).toHaveValue('Photo 4');
});

test('rejects files that are not supported images, without saving anything', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  const attempts: [string, any, string][] = [
    ['an unsupported type', { name: 'climb.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }, 'Choose JPEG, PNG, or WebP images.'],
    ['a file over 8 MB', { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) }, 'Each image must be smaller than 8 MB.'],
    // The browser trusts the file's name, so the server checks the contents.
    ['a PNG name with other contents', { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not really an image') }, 'The file is not a supported image.'],
  ];
  for (const [what, file, message] of attempts) {
    await test.step(what, async () => {
      await chooseFiles(page, '+ Upload images', [file]);
      await dialogError(page, 'Upload', message);
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    });
  }
  // API/DB check: no photo was added.
  expect(find(await guide(page), boulder.id).images, 'API/DB: no photos saved').toEqual([]);
});

test('rejects blank names and names already used on the boulder', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix);
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  await chooseFiles(page, '+ Upload images', [mediaFile('png'), mediaFile('png')]);
  const dialog = page.getByRole('dialog');
  // A name of only spaces passes the browser's required check but is refused.
  await dialog.getByLabel('Photo 1 name').fill('   ');
  await dialogError(page, 'Upload', 'Enter a name for each file.');
  // An existing photo's name is refused regardless of case and surrounding spaces...
  await dialog.getByLabel('Photo 1 name').fill('  SEED photo ');
  await dialogError(page, 'Upload', /^A photo named ".+" already exists for this boulder\. Choose a different name\.$/);
  // ...as are two new photos with the same name.
  await dialog.getByLabel('Photo 1 name').fill('Twin');
  await dialog.getByLabel('Photo 2 name').fill('twin');
  await dialogError(page, 'Upload', /^A photo named ".+" already exists for this boulder\. Choose a different name\.$/);
  // API/DB check: only the seeded photo exists.
  expect(find(await guide(page), boulder.id).images.map((i: any) => i.name), 'API/DB: no photos saved').toEqual(['Seed photo']);
});

// The last check is a regression test: removing a photo used to leave its annotations in problems' photoAnnotations.
test('removing a boulder photo also removes it from its problems', async () => {
  const { location, boulder, problem, image } = await seedLocation(user.current.request, prefix);
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  await page.getByRole('button', { name: 'Remove image Seed photo', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Remove image?', exact: true })).toBeVisible();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  expect((await saved).status(), 'Removal saved').toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Image removed' })).toBeVisible();
  await expect(page.locator('.photo-grid')).toHaveCount(0);
  // API/DB check: the photo is gone from the boulder and from the problem it was attached to, with its annotations.
  const current = await guide(page);
  expect(find(current, image.id), 'API/DB: photo removed').toBeUndefined();
  expect(find(current, problem.id).imageIds, 'API/DB: problem link removed').toEqual([]);
  expect(find(current, problem.id).photoAnnotations, "API/DB: the problem's annotations for the photo removed").not.toHaveProperty(image.id);
});

// Regression: photos saved together share a created_at and read_content used to break the tie by random ID,
// so they came back shuffled. Four photos make a lucky pass 1 in 24 if it regresses.
test('photos uploaded together keep the order they were chosen in', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  await chooseFiles(page, '+ Upload images', [mediaFile('png'), mediaFile('jpg'), mediaFile('webp'), mediaFile('png')]);
  await completeUpload(page);
  const order = ['Photo 1', 'Photo 2', 'Photo 3', 'Photo 4'];
  await expect(page.locator('.photo-grid .photo-card span')).toHaveText(order);
  expect(find(await guide(page), boulder.id).images.map((i: any) => i.name), 'API/DB: saved in the chosen order').toEqual(order);
});

test('parking photos can be uploaded with a caption, recaptioned and removed', async () => {
  const { location } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id }, location.name);
  const photos = page.locator('.problem-photo');
  // Upload with a caption; parking photos offer one in the naming dialog.
  await chooseFiles(page, '+ Upload photos', [mediaFile('jpg')]);
  await completeUpload(page, { names: ['Lay-by'], captions: ['Park facing the gate.'] });
  await expect(photos.filter({ hasText: 'Lay-by' })).toContainText('Park facing the gate.');
  // Change the caption.
  await photos.filter({ hasText: 'Lay-by' }).getByRole('button', { name: 'Edit caption', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Caption (optional)').fill('Park on the verge.');
  const recaptioned = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Save caption', exact: true }).click();
  expect((await recaptioned).status(), 'Caption saved').toBe(200);
  await expect(photos.filter({ hasText: 'Lay-by' })).toContainText('Park on the verge.');
  expect(find(await guide(page), location.id).photos[0], 'API/DB: caption saved').toMatchObject({ name: 'Lay-by', caption: 'Park on the verge.' });
  // Remove it.
  await photos.filter({ hasText: 'Lay-by' }).getByRole('button', { name: 'Remove photo', exact: true }).click();
  const removed = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Remove photo', exact: true }).click();
  expect((await removed).status(), 'Removal saved').toBe(200);
  await expect(page.getByText('No parking or approach photos yet.', { exact: true })).toBeVisible();
  expect(find(await guide(page), location.id).photos, 'API/DB: photo removed').toEqual([]);
});

/** The user's stored upload total, from the storage allowance API. */
const usedBytes = async () => (await (await user.current.request.get('/api/storage/usage')).json()).usedBytes as number;

// Fails until fixed: uploadNamedPhotos (src/main.jsx) checks each file only just before uploading it, so the valid
// files before an invalid one are already stored. Nothing is saved to the guide, so they are orphaned, but they
// still count towards the user's 10 GB allowance.
test('a batch with an unsupported file uploads nothing', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  const before = await usedBytes();
  await chooseFiles(page, '+ Upload images', [mediaFile('png'), { name: 'climb.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }]);
  await dialogError(page, 'Upload', 'Choose JPEG, PNG, or WebP images.');
  expect(find(await guide(page), boulder.id).images, 'API/DB: no photos saved').toEqual([]);
  expect(await usedBytes(), 'No file was stored').toBe(before);
});

test('a photo of exactly 8 MB uploads', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  // A real PNG padded to the limit; data after the image's end marker is ignored by viewers.
  const png = mediaFile('png').buffer;
  const file = { name: 'limit.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024 - png.length)]) };
  expect(file.buffer.length).toBe(8 * 1024 * 1024);
  await chooseFiles(page, '+ Upload images', [file]);
  await completeUpload(page, { names: ['Exactly 8 MB'] });
  expect(find(await guide(page), boulder.id).images.map((i: any) => i.name), 'API/DB: photo saved').toEqual(['Exactly 8 MB']);
});

test('a failed upload keeps the dialog open, saves nothing, and can be retried', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  for (const [what, fail] of [
    ['the server fails', (route: any) => route.fulfill({ status: 500, json: { error: 'Could not save or load the guide. Please try again.' } })],
    ['the connection drops', (route: any) => route.abort('connectionreset')],
  ] as const) {
    await test.step(what, async () => {
      await page.route('**/api/images', fail, { times: 1 });
      await chooseFiles(page, '+ Upload images', [mediaFile('png')]);
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Photo 1 name').fill('Retried photo');
      await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
      // The error is shown in the dialog, which keeps the chosen name.
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.getByLabel('Photo 1 name')).toHaveValue('Retried photo');
      expect(find(await guide(page), boulder.id).images, 'API/DB: nothing saved').toEqual([]);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
  }
  // With the connection back, the same upload succeeds.
  await chooseFiles(page, '+ Upload images', [mediaFile('png')]);
  await completeUpload(page, { names: ['Retried photo'] });
  expect(find(await guide(page), boulder.id).images.map((i: any) => i.name), 'API/DB: saved on retry').toEqual(['Retried photo']);
});
