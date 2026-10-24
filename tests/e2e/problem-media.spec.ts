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
  const page = await openPage(
    user.current.context,
    { location: seed.location.id, boulder: seed.boulder.id, problem: seed.problem.id },
    'V2 (5+) - Seed Problem'
  );
  return { ...seed, page };
}

/** The problem banner's photo and video counts. */
const counts = (page: Page) => page.locator('.problem-banner .banner-bottom span').first();

/**
 * Open the "Add from the boulder page" dialog for photos or videos.
 * @param kind - `Photo` or `Video`.
 */
async function openAttach(page: Page, kind: 'Photo' | 'Video') {
  await page.getByRole('button', { name: '+ Add ' + kind }).click();
  await page.getByRole('button', { name: `Add ${kind.toLowerCase()} from the Seed Boulder page`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: `Add ${kind.toLowerCase()} from Seed Boulder page`, exact: true })
  ).toBeVisible();
  return dialog;
}

for (const kind of ['Photo', 'Video'] as const) {
  test(`attaches a ${kind.toLowerCase()} from the boulder, then offers nothing more`, async () => {
    const { page, problem, image, video } = await unattached();
    const item = kind === 'Photo' ? image : video;
    await expect(counts(page)).toHaveText('0 photos · 0 videos');
    const dialog = await openAttach(page, kind);
    // Nothing can be added until something is chosen.
    const add = dialog.getByRole('button', { name: 'Add selected', exact: true });
    await expect(add).toBeDisabled();
    await dialog.getByRole('checkbox', { name: item.name, exact: true }).check();
    const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
    await add.click();
    expect((await saved).status(), 'Attachment saved').toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(counts(page)).toHaveText(kind === 'Photo' ? '1 photo · 0 videos' : '0 photos · 1 video');
    // API/DB check: the problem links the item.
    expect(find(await guide(page), problem.id)[kind === 'Photo' ? 'imageIds' : 'videoIds'], 'API/DB: attached').toEqual(
      [item.id]
    );
    // With everything attached, the dialog says there is nothing left and links to the boulder.
    const empty = await openAttach(page, kind);
    await expect(empty.getByText(`No ${kind.toLowerCase()}s available.`)).toBeVisible();
    await expect(empty.getByRole('link', { name: 'Seed Boulder', exact: true })).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Add selected', exact: true })).toBeDisabled();
  });
}

test('a photo uploaded from a problem is added to the boulder and attached to the problem', async () => {
  const { page, boulder, problem } = await unattached();
  await page.getByRole('button', { name: '+ Add Photo' }).click();
  await chooseFiles(page, 'Upload photo from files', [mediaFile('jpg')]);
  await completeUpload(page, { names: ['Problem topo'] });
  await expect(page.locator('.problem-photo').filter({ hasText: 'Problem topo' })).toBeVisible();
  // API/DB check: the photo is on the boulder and linked from the problem.
  const current = await guide(page);
  const uploaded = find(current, boulder.id).images.find((i: any) => i.name === 'Problem topo');
  expect(uploaded, 'API/DB: photo added to the boulder').toBeDefined();
  expect(find(current, problem.id).imageIds, 'API/DB: photo attached to the problem').toEqual([uploaded.id]);
});

test('removing a photo from a problem keeps it on the boulder and other problems', async () => {
  const seed = await seedLocation(user.current.request, prefix);
  // A second problem uses the same photo.
  const second = {
    id: crypto.randomUUID(),
    name: 'Second line',
    grade: 'V4 (6B/6B+)',
    description: 'Shares the photo.',
    imageIds: [seed.image.id],
    videoIds: [],
  };
  expect(
    (await editGuide(user.current.request, g => find(g, seed.boulder.id).problems.push(second))).status(),
    'Second problem added'
  ).toBe(200);
  const page = await openPage(
    user.current.context,
    { location: seed.location.id, boulder: seed.boulder.id, problem: seed.problem.id },
    'V2 (5+) - Seed Problem'
  );
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

test('the Edit problem form links and unlinks photos and videos', async () => {
  const { page, problem, image, video } = await unattached();
  /** Open Edit problem, set the media checkboxes and save. */
  async function setLinks(checked: boolean) {
    await page.getByRole('button', { name: 'Edit problem', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('group', { name: 'Link photos from this boulder' })
      .getByRole('checkbox', { name: 'Seed photo' })
      .setChecked(checked);
    await dialog
      .getByRole('group', { name: 'Link beta videos from this boulder' })
      .getByRole('checkbox', { name: 'Seed video' })
      .setChecked(checked);
    const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Save problem', exact: true }).click();
    expect((await saved).status(), 'Problem saved').toBe(200);
  }
  await setLinks(true);
  await expect(counts(page)).toHaveText('1 photo · 1 video');
  expect(find(await guide(page), problem.id), 'API/DB: linked').toMatchObject({
    imageIds: [image.id],
    videoIds: [video.id],
  });
  await setLinks(false);
  await expect(counts(page)).toHaveText('0 photos · 0 videos');
  expect(find(await guide(page), problem.id), 'API/DB: unlinked').toMatchObject({ imageIds: [], videoIds: [] });
});
