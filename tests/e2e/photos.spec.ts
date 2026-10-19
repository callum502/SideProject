import { test, expect } from './fixtures';
import { chooseFiles, completeUpload, dialogError } from './testHelpers';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation, editGuide } from './seedHelpers';
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

// Regression: valid files before an unsupported one in the same batch used to be uploaded before the bad file was
// found, leaving them stored but unused, still counting towards the user's 10 GB allowance.
test('a batch with an unsupported file uploads nothing', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  let uploads = 0;
  page.on('request', request => { if (request.url().endsWith('/api/images')) uploads++; });
  const before = await usedBytes();
  for (const [what, bad, message] of [
    ['a file of the wrong type', { name: 'climb.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }, 'Choose JPEG, PNG, or WebP images.'],
    ['a file over 8 MB', { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) }, 'Each image must be smaller than 8 MB.'],
  ] as const) {
    await test.step(what, async () => {
      // The bad file comes last, after valid ones.
      await chooseFiles(page, '+ Upload images', [mediaFile('png'), mediaFile('jpg'), bad]);
      await dialogError(page, 'Upload', message);
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    });
  }
  expect(uploads, 'No file was uploaded').toBe(0);
  expect(find(await guide(page), boulder.id).images, 'API/DB: no photos saved').toEqual([]);
  expect(await usedBytes(), 'No storage used').toBe(before);
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

// Regression: removing a photo used to delete only its database record, leaving the file in Storage, still counting
// towards the uploader's 10 GB allowance and still reachable at its old link.
test('removing a photo frees its storage, and its old link stops working', async () => {
  const { location, boulder, image } = await seedLocation(user.current.request, prefix);
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  expect((await user.current.request.get(image.url)).status(), 'The photo is reachable while in the guide').toBe(200);
  const before = await usedBytes();
  await page.getByRole('button', { name: 'Remove image Seed photo', exact: true }).click();
  const removed = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  expect((await removed).status(), 'Removal saved').toBe(200);
  await expect.poll(usedBytes, { message: 'Storage used went down', timeout: 5000 }).toBeLessThan(before);
  expect((await user.current.request.get(image.url)).status(), 'The old link no longer works').toBeGreaterThanOrEqual(400);
});

// Fails until fixed: only the server can tell that a file named and typed as an image isn't one, and by then the
// earlier files in the batch are already stored, unused but counting towards the allowance.
test('a batch with a disguised file stores nothing', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  const before = await usedBytes();
  await chooseFiles(page, '+ Upload images', [mediaFile('png'), { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not really an image') }]);
  await dialogError(page, 'Upload', 'The file is not a supported image.');
  expect(find(await guide(page), boulder.id).images, 'API/DB: no photos saved').toEqual([]);
  expect(await usedBytes(), 'No file was stored').toBe(before);
});

test('media links work for guests, and missing or malformed links are refused', async ({ browser }) => {
  const { image, video } = await seedLocation(user.current.request, prefix);
  const guest = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    // A guest can view a photo: the link redirects to Storage, which serves the image.
    const photo = await guest.request.get(image.url);
    expect(photo.status(), 'Photo served to a guest').toBe(200);
    expect(photo.headers()['content-type'], 'Served as an image').toBe('image/png');
    // A download link passes the chosen file name on to Storage.
    const download = await guest.request.get(video.url + '?download=' + encodeURIComponent('Sit start beta'), { maxRedirects: 0 });
    expect(download.status(), 'Download redirects').toBe(302);
    expect(new URL(download.headers().location).searchParams.get('download'), 'Download name kept').toBe('Sit start beta');
    // A well-formed link to a file that doesn't exist fails.
    const owner = user.current.account.id;
    expect((await guest.request.get(`/media/${owner}/${crypto.randomUUID()}.png`)).status(), 'Missing file refused').toBeGreaterThanOrEqual(400);
    // Malformed links never reach Storage.
    for (const path of ['/media/%2e%2e/%2e%2e/.env.local', `/media/${owner}/..%2f..%2fserver.mjs`, `/media/${owner}/x.exe`, '/media/not-a-user/x.png', `/media/${owner}/${crypto.randomUUID()}.png/extra`]) {
      const response = await guest.request.get(path, { maxRedirects: 0 });
      expect.soft(response.status(), path + ' refused').toBe(404);
    }
  } finally { await guest.close(); }
});

test('a removed photo that is also a profile photo keeps its file', async () => {
  const { location, boulder, image } = await seedLocation(user.current.request, prefix);
  // The user's profile photo is the same file as the guide photo.
  expect((await user.current.request.post('/api/profile-photo', { data: { url: image.url } })).status(), 'Profile photo set').toBe(200);
  try {
    const before = await usedBytes();
    const removed = await editGuide(user.current.request, g => { find(g, boulder.id).images = []; find(g, boulder.id).problems.forEach((p: any) => { p.imageIds = []; p.photoAnnotations = {}; }); });
    expect(removed.status(), 'Photo removed from the guide').toBe(200);
    // The file is still in use, so it stays: the profile photo still works and storage is unchanged.
    expect((await user.current.request.get(image.url)).status(), 'File still served').toBe(200);
    expect((await user.current.request.get('/api/profile-photo?id=' + user.current.account.id)).status(), 'Profile photo still works').toBe(200);
    expect(await usedBytes(), 'Storage unchanged').toBe(before);
    expect(find(await guide(user.current.page), location.id), 'API/DB: location still there').toBeDefined();
  } finally {
    await user.current.request.post('/api/profile-photo', { data: { url: null } });
  }
});

test("removing a location deletes the files of all its photos and videos", async () => {
  const { location, image, video, parking } = await seedLocation(user.current.request, prefix);
  const before = await usedBytes();
  const removed = await editGuide(user.current.request, g => { g.locations = g.locations.filter((l: any) => l.id !== location.id); });
  expect(removed.status(), 'Location removed').toBe(200);
  for (const [what, url] of [['photo', image.url], ['video', video.url], ['parking photo', parking.url]]) {
    expect.soft((await user.current.request.get(url)).status(), what + ' link no longer works').toBeGreaterThanOrEqual(400);
  }
  expect(await usedBytes(), 'Storage freed').toBeLessThan(before);
});
