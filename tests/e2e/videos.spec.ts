import { test, expect } from './fixtures';
import { chooseFiles, completeUpload, dialogError } from './testHelpers';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation } from './seedHelpers';
import { mediaFile, oversizedFile } from './media';

const prefix = 'test_videos_loc_';
const user = testUser('test_videos_user_', prefix);

/** Open the seeded problem's page. */
const openProblem = (seed: any) =>
  openPage(
    user.current.context,
    { location: seed.location.id, boulder: seed.boulder.id, problem: seed.problem.id },
    'V2 (5+) - Seed Problem'
  );

test('uploads MP4, WebM and MOV videos to a problem with download links', async () => {
  const seed = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openProblem(seed);
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
  await expect(page.locator('.problem-banner .banner-bottom span').first()).toHaveText('0 photos · 3 videos');
  // API/DB check: each video kept its type and name, in the chosen order, and is on the problem.
  const current = await guide(page);
  const videos = find(current, seed.boulder.id).videos;
  expect(
    videos.map((v: any) => v.name + '.' + v.url.split('.').pop()),
    'API/DB: names and file types saved in order'
  ).toEqual(['Sit start beta.mp4', 'Video 2.webm', 'Video 3.mov']);
  expect(find(current, seed.problem.id).videoIds, 'API/DB: attached to the problem').toEqual(
    videos.map((v: any) => v.id)
  );
});

test('the boulder page has no videos, and its problems show their photo and video counts', async () => {
  const seed = await seedLocation(user.current.request, prefix);
  const page = await openPage(
    user.current.context,
    { location: seed.location.id, boulder: seed.boulder.id },
    'Seed Boulder'
  );
  await expect(page.getByRole('heading', { name: 'Beta videos' })).toHaveCount(0);
  await expect(page.getByText('+ Upload video')).toHaveCount(0);
  const row = page.locator('.problem-row').filter({ hasText: 'Seed Problem' });
  await expect(row.locator('.problem-media-counts')).toContainText('1 photo');
  await expect(row.locator('.problem-media-counts')).toContainText('1 video');
});

test('rejects files that are not supported videos, without saving anything', async () => {
  const seed = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openProblem(seed);
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
  expect(find(await guide(page), seed.boulder.id).videos, 'API/DB: no videos saved').toEqual([]);
});

test('removing a video from its only problem deletes it', async () => {
  const seed = await seedLocation(user.current.request, prefix);
  const page = await openProblem(seed);
  await page.getByRole('button', { name: 'Remove video Seed video', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Remove video?', exact: true })).toBeVisible();
  await expect(dialog).toContainText('it will be deleted');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Remove video', exact: true }).click();
  expect((await saved).status(), 'Removal saved').toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Video removed' })).toBeVisible();
  await expect(page.locator('.video-card')).toHaveCount(0);
  // API/DB check: the video is gone from the boulder and from the problem.
  const current = await guide(page);
  expect(find(current, seed.video.id), 'API/DB: video removed').toBeUndefined();
  expect(find(current, seed.problem.id).videoIds, 'API/DB: problem link removed').toEqual([]);
});

test('a batch with an unsupported file uploads nothing', async () => {
  const seed = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openProblem(seed);
  const usedBytes = async () =>
    (await (await user.current.request.get('/api/storage/usage')).json()).usedBytes as number;
  const before = await usedBytes();
  await chooseFiles(page, '+ Upload video', [
    mediaFile('mp4'),
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('beta') },
  ]);
  await dialogError(page, 'Upload', 'Choose MP4, WebM, or MOV videos.');
  expect(find(await guide(page), seed.boulder.id).videos, 'API/DB: no videos saved').toEqual([]);
  expect(await usedBytes(), 'No file was stored').toBe(before);
});
