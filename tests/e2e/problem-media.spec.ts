import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { chooseFiles, completeUpload } from './testHelpers';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation, editGuide } from './seedHelpers';
import { mediaFile } from './media';

const prefix = 'test_attach_loc_';
const user = testUser('test_attach_user_', prefix);

/**
 * Seed a location whose boulder has a photo and a video that are not yet attached to its problem.
 * @returns The seeded records and the problem page.
 */
async function unattached() {
  const seed = await seedLocation(user.current.request, prefix);
  const response = await editGuide(user.current.request, g =>
    Object.assign(find(g, seed.problem.id), { imageIds: [], videoIds: [], photoAnnotations: {} })
  );
  expect(response.status(), 'Detached the seeded media').toBe(200);
  const page = await openProblem(seed);
  return { ...seed, page };
}

/** Open a seeded problem's page, or another problem on the seeded boulder. */
const openProblem = (seed: any, problem = seed.problem) =>
  openPage(
    user.current.context,
    { location: seed.location.id, boulder: seed.boulder.id, problem: problem.id },
    `${problem.grade} - ${problem.name}`
  );

/** Add a second problem to the seeded boulder. */
async function addProblem(seed: any, fields: Record<string, any> = {}) {
  const problem = {
    id: crypto.randomUUID(),
    name: 'Second line',
    grade: 'V4 (6B/6B+)',
    description: 'Another way up.',
    imageIds: [],
    videoIds: [],
    ...fields,
  };
  expect(
    (await editGuide(user.current.request, g => find(g, seed.boulder.id).problems.push(problem))).status(),
    'Second problem added'
  ).toBe(200);
  return problem;
}

/** The problem banner's photo and video counts. */
const counts = (page: Page) => page.locator('.problem-banner .banner-bottom span').first();

/** Open the dialog that reuses a photo, or adds an unassigned video, from the boulder. */
async function openAttach(page: Page, kind: 'Photo' | 'Video') {
  await page.getByRole('button', { name: '+ Add ' + kind }).click();
  await page
    .getByRole('button', {
      name: kind === 'Photo' ? /^Reuse a photo from Seed Boulder/ : 'Add a video already on Seed Boulder',
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', {
      name: kind === 'Photo' ? 'Reuse a photo from Seed Boulder' : 'Add a video from Seed Boulder',
      exact: true,
    })
  ).toBeVisible();
  return dialog;
}

/** Tick items in the open attach dialog and save. */
async function attach(page: Page, dialog: any, names: string[]) {
  for (const name of names) await dialog.getByRole('checkbox', { name, exact: true }).check();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Add selected', exact: true }).click();
  expect((await saved).status(), 'Attachment saved').toBe(200);
  await expect(dialog).toHaveCount(0);
}

test('reuses a boulder photo on a problem, then offers nothing more', async () => {
  const { page, problem, image } = await unattached();
  await expect(counts(page)).toHaveText('0 photos · 0 videos');
  const dialog = await openAttach(page, 'Photo');
  await expect(dialog.getByRole('group', { name: 'Boulder photos' })).toBeVisible();
  // Nothing can be added until something is chosen.
  await expect(dialog.getByRole('button', { name: 'Add selected', exact: true })).toBeDisabled();
  await attach(page, dialog, [image.name]);
  await expect(counts(page)).toHaveText('1 photo · 0 videos');
  expect(find(await guide(page), problem.id).imageIds, 'API/DB: attached').toEqual([image.id]);
  // With everything attached, the dialog says there is nothing left and links to the boulder.
  const empty = await openAttach(page, 'Photo');
  await expect(empty.getByText('No other photos on Seed Boulder yet.', { exact: false })).toBeVisible();
  await expect(empty.getByRole('link', { name: 'Seed Boulder', exact: true })).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Add selected', exact: true })).toBeDisabled();
});

test("reuses another problem's photo with separate markings", async () => {
  const seed = await seedLocation(user.current.request, prefix, { media: false });
  let page = await openProblem(seed);
  // A topo uploaded on the first problem stays off the boulder page.
  await page.getByRole('button', { name: '+ Add Photo' }).click();
  await chooseFiles(page, 'Upload a new photo', [mediaFile('jpg')]);
  await completeUpload(page, { names: ['Shared topo'] });
  const topo = find(await guide(page), seed.boulder.id).images.find((i: any) => i.name === 'Shared topo');
  expect(topo, 'API/DB: saved off the boulder page').toMatchObject({ onBoulderPage: false });
  const marks = [{ type: 'box', color: 'green', x: 100, y: 100, x2: 200, y2: 200 }];
  expect(
    (
      await editGuide(user.current.request, g => (find(g, seed.problem.id).photoAnnotations = { [topo.id]: marks }))
    ).status(),
    'Annotated on the first problem'
  ).toBe(200);
  // The second problem finds it under "From other problems", labelled with where it is used.
  const second = await addProblem(seed);
  page = await openProblem(seed, second);
  const dialog = await openAttach(page, 'Photo');
  const group = dialog.getByRole('group', { name: 'From other problems' });
  await expect(group.getByText('Used on Seed Problem')).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Boulder photos' })).toHaveCount(0);
  await attach(page, dialog, ['Shared topo']);
  await expect(page.locator('.problem-photo').filter({ hasText: 'Shared topo' })).toBeVisible();
  // API/DB check: both problems use it; only the first has markings on it.
  const current = await guide(page);
  expect(find(current, second.id).imageIds, 'API/DB: reused').toEqual([topo.id]);
  expect(find(current, second.id).photoAnnotations ?? {}, 'API/DB: no markings copied').not.toHaveProperty(topo.id);
  expect(find(current, seed.problem.id).photoAnnotations[topo.id], 'API/DB: first markings kept').toEqual(marks);
  // The boulder page still only shows boulder photos.
  page = await openPage(user.current.context, { location: seed.location.id, boulder: seed.boulder.id }, 'Seed Boulder');
  await expect(page.getByText('Show climbers what this boulder looks like.')).toBeVisible();
});

test('adds a video left on the boulder to a problem, after which only upload is offered', async () => {
  const { page, problem, video } = await unattached();
  const dialog = await openAttach(page, 'Video');
  await attach(page, dialog, [video.name]);
  await expect(counts(page)).toHaveText('0 photos · 1 video');
  expect(find(await guide(page), problem.id).videoIds, 'API/DB: attached').toEqual([video.id]);
  await expect(page.locator('label', { hasText: '+ Upload video' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add Video' })).toHaveCount(0);
});

test('a photo uploaded from a problem is attached to it and kept off the boulder page', async () => {
  const { page, boulder, problem } = await unattached();
  await page.getByRole('button', { name: '+ Add Photo' }).click();
  await chooseFiles(page, 'Upload a new photo', [mediaFile('jpg')]);
  await completeUpload(page, { names: ['Problem topo'] });
  await expect(page.locator('.problem-photo').filter({ hasText: 'Problem topo' })).toBeVisible();
  // API/DB check: the photo is on the boulder, off its page, and linked from the problem.
  const current = await guide(page);
  const uploaded = find(current, boulder.id).images.find((i: any) => i.name === 'Problem topo');
  expect(uploaded, 'API/DB: photo added off the boulder page').toMatchObject({ onBoulderPage: false });
  expect(find(current, problem.id).imageIds, 'API/DB: photo attached to the problem').toEqual([uploaded.id]);
});

test('removing a photo from a problem keeps it on the boulder and other problems', async () => {
  const seed = await seedLocation(user.current.request, prefix);
  // A second problem uses the same photo.
  const second = await addProblem(seed, { imageIds: [seed.image.id] });
  const page = await openProblem(seed);
  await page
    .locator('.problem-photo')
    .filter({ hasText: 'Seed photo' })
    .getByRole('button', { name: 'Remove photo', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Remove photo from problem?', exact: true })).toBeVisible();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Remove photo', exact: true }).click();
  expect((await saved).status(), 'Removal saved').toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Photo removed from problem' })).toBeVisible();
  await expect(page.locator('.problem-photo')).toHaveCount(0);
  // API/DB check: only this problem's link was removed.
  const current = await guide(page);
  expect(find(current, seed.problem.id).imageIds, 'API/DB: unlinked from this problem').toEqual([]);
  expect(find(current, second.id).imageIds, 'API/DB: still linked from the other problem').toEqual([seed.image.id]);
  expect(find(current, seed.image.id), 'API/DB: still on the boulder').toBeDefined();
});

test("removing a problem's own topo from it deletes the photo", async () => {
  const seed = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openProblem(seed);
  await page.getByRole('button', { name: '+ Add Photo' }).click();
  await chooseFiles(page, 'Upload a new photo', [mediaFile('png')]);
  await completeUpload(page, { names: ['Only here'] });
  await page.locator('.problem-photo').getByRole('button', { name: 'Remove photo', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Remove photo?', exact: true })).toBeVisible();
  await expect(dialog).toContainText('it will be deleted');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Remove photo', exact: true }).click();
  expect((await saved).status(), 'Removal saved').toBe(200);
  expect(find(await guide(page), seed.boulder.id).images, 'API/DB: photo deleted').toEqual([]);
});

test('removing a problem deletes media only it used, and keeps boulder photos', async () => {
  const seed = await seedLocation(user.current.request, prefix);
  // A second problem, also using the boulder photo, gets its own topo and video.
  const second = await addProblem(seed, { imageIds: [seed.image.id] });
  const page = await openProblem(seed, second);
  await page.getByRole('button', { name: '+ Add Photo' }).click();
  await chooseFiles(page, 'Upload a new photo', [mediaFile('png')]);
  await completeUpload(page, { names: ['Second topo'] });
  await chooseFiles(page, '+ Upload video', [mediaFile('mp4')]);
  await completeUpload(page, { names: ['Second beta'] });
  await page.getByRole('button', { name: 'Remove problem', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('will be deleted too');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Remove problem', exact: true }).click();
  expect((await saved).status(), 'Removal saved').toBe(200);
  // API/DB check: its own topo and video are gone; the shared boulder photo and the first problem's video stay.
  const boulder = find(await guide(page), seed.boulder.id);
  expect(
    boulder.images.map((i: any) => i.name),
    'API/DB: only the boulder photo is left'
  ).toEqual(['Seed photo']);
  expect(
    boulder.videos.map((v: any) => v.name),
    "API/DB: only the first problem's video is left"
  ).toEqual(['Seed video']);
});

test('the Edit problem form keeps photos and videos', async () => {
  const seed = await seedLocation(user.current.request, prefix);
  const page = await openProblem(seed);
  await page.getByRole('button', { name: 'Edit problem', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('group')).toHaveCount(0);
  await dialog.getByLabel(/Problem name/).fill('Renamed');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Save problem', exact: true }).click();
  expect((await saved).status(), 'Problem saved').toBe(200);
  expect(find(await guide(page), seed.problem.id), 'API/DB: media kept').toMatchObject({
    name: 'Renamed',
    imageIds: [seed.image.id],
    videoIds: [seed.video.id],
  });
});
