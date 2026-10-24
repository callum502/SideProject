import { test, expect } from './fixtures';
import { chooseFiles, completeUpload, dialogError } from './testHelpers';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation } from './seedHelpers';
import { mediaFile, oversizedFile } from './media';

const prefix = 'test_videos_loc_';
const user = testUser('test_videos_user_', prefix);

test('uploads MP4, WebM and MOV videos to a boulder with download links', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  await chooseFiles(page, '+ Upload video', [mediaFile('mp4'), mediaFile('webm'), mediaFile('mov')]);
  await expect(page.getByRole('dialog').getByLabel('Video 1 name')).toHaveValue('Video 1');
  await completeUpload(page, { names: ['Sit start beta'] });
  // Each video has a player and a download link named after it.
  for (const name of ['Sit start beta', 'Video 2', 'Video 3']) {
    const card = page.locator('.video-card').filter({ hasText: name });
    await expect(card.locator(`video[aria-label="${name}"]`)).toBeAttached();
    await expect(card.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      new RegExp('\\?download=' + encodeURIComponent(name) + '$')
    );
  }
  await expect(page.locator('.detail-banner .banner-bottom span').first()).toHaveText(
    '1 problem · 0 photos · 3 videos'
  );
  // API/DB check: each video kept its type and name, in the chosen order.
  const videos = find(await guide(page), boulder.id).videos;
  expect(
    videos.map((v: any) => v.name + '.' + v.url.split('.').pop()),
    'API/DB: names and file types saved in order'
  ).toEqual(['Sit start beta.mp4', 'Video 2.webm', 'Video 3.mov']);
});

test('rejects files that are not supported videos, without saving anything', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  const attempts: [string, any, string][] = [
    [
      'an unsupported type',
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('beta') },
      'Choose MP4, WebM, or MOV videos.',
    ],
    ['a file over 100 MB', oversizedFile(100, 'mp4'), 'Each video must be smaller than 100 MB.'],
    // The browser trusts the file's name, so the server checks the contents.
    [
      'an MP4 name with other contents',
      { name: 'fake.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video at all') },
      'The file is not a supported video.',
    ],
  ];
  for (const [what, file, message] of attempts) {
    await test.step(what, async () => {
      await chooseFiles(page, '+ Upload video', [file]);
      await dialogError(page, 'Upload', message);
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    });
  }
  expect(find(await guide(page), boulder.id).videos, 'API/DB: no videos saved').toEqual([]);
});

test('removing a boulder video also removes it from its problems', async () => {
  const { location, boulder, problem, video } = await seedLocation(user.current.request, prefix);
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  await page.getByRole('button', { name: 'Remove video Seed video', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Remove video?', exact: true })).toBeVisible();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  expect((await saved).status(), 'Removal saved').toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Video removed' })).toBeVisible();
  await expect(page.getByText('Spray beta here.', { exact: true })).toBeVisible();
  // API/DB check: the video is gone from the boulder and from the problem it was attached to.
  const current = await guide(page);
  expect(find(current, video.id), 'API/DB: video removed').toBeUndefined();
  expect(find(current, problem.id).videoIds, 'API/DB: problem link removed').toEqual([]);
});

test('a batch with an unsupported file uploads nothing', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  const usedBytes = async () =>
    (await (await user.current.request.get('/api/storage/usage')).json()).usedBytes as number;
  const before = await usedBytes();
  await chooseFiles(page, '+ Upload video', [
    mediaFile('mp4'),
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('beta') },
  ]);
  await dialogError(page, 'Upload', 'Choose MP4, WebM, or MOV videos.');
  expect(find(await guide(page), boulder.id).videos, 'API/DB: no videos saved').toEqual([]);
  expect(await usedBytes(), 'No file was stored').toBe(before);
});
