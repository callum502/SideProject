import { test, expect } from './fixtures';
import { dialogError } from './testHelpers';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation, editGuide, uploadImage } from './seedHelpers';

const prefix = 'test_locpage_loc_';
const user = testUser('test_locpage_user_', prefix);

test('the banners count boulders, problems, photos and videos', async () => {
  const seed = await seedLocation(user.current.request, prefix);
  const banner = (page: any) => page.locator('.detail-banner .banner-bottom span').first();
  // One of everything; parking photos are not counted as boulder photos.
  let page = await openPage(user.current.context, { location: seed.location.id }, seed.location.name);
  await expect(banner(page)).toHaveText('1 boulder · 1 problem · 1 photo · 1 video');
  // Add a second boulder with two problems and a photo.
  const url = await uploadImage(user.current.request);
  const image = { id: crypto.randomUUID(), name: 'Second photo', caption: '', url, annotations: [] };
  const problem = (name: string) => ({ id: crypto.randomUUID(), name, grade: 'V1 (5)', description: 'Climb it.', imageIds: [], videoIds: [] });
  const boulder = { id: crypto.randomUUID(), name: 'Second Boulder', notes: 'Further on.', otherNotes: '', images: [image], videos: [], problems: [problem('One'), problem('Two')] };
  expect((await editGuide(user.current.request, g => find(g, seed.location.id).boulders.push(boulder))).status(), 'Second boulder added').toBe(200);
  // The location totals every boulder; each boulder counts its own.
  page = await openPage(user.current.context, { location: seed.location.id }, seed.location.name);
  await expect(banner(page)).toHaveText('2 boulders · 3 problems · 2 photos · 1 video');
  page = await openPage(user.current.context, { location: seed.location.id, boulder: boulder.id }, 'Second Boulder');
  await expect(banner(page)).toHaveText('2 problems · 1 photo · 0 videos');
});

test('additional links can be added, edited and removed, and must be valid', async () => {
  const { location } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id }, location.name);
  const dialog = page.getByRole('dialog');
  const links = () => dialog.getByRole('group');
  /** Open the links dialog. */
  async function edit() {
    await page.getByRole('button', { name: 'Edit links', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Additional links', exact: true })).toBeVisible();
  }
  /** Save the links dialog and verify the guide saved. */
  async function save() {
    const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Save links', exact: true }).click();
    expect((await saved).status(), 'Links saved').toBe(200);
    await expect(dialog).toHaveCount(0);
  }

  await test.step('add', async () => {
    await edit();
    await dialog.getByRole('button', { name: '+ Add link', exact: true }).click();
    await links().nth(1).getByLabel('Label').fill('Tide times');
    await links().nth(1).getByLabel('URL').fill('https://example.com/tides');
    await save();
    const link = page.getByRole('link', { name: 'Tide times' });
    await expect(link).toHaveAttribute('href', 'https://example.com/tides');
    await expect(link).toHaveAttribute('target', '_blank');
  });

  await test.step('reject an unsafe link', async () => {
    await edit();
    await links().nth(0).getByLabel('URL').fill('javascript:alert(1)');
    await dialogError(page, 'Save links', 'Each link needs a label and a valid HTTP or HTTPS URL.');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  await test.step('edit and remove', async () => {
    await edit();
    await links().nth(1).getByLabel('Label').fill('Tide chart');
    await links().nth(0).getByRole('button', { name: 'Remove link', exact: true }).click();
    await save();
    await expect(page.getByRole('link', { name: 'Seed guidebook' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Tide chart' })).toBeVisible();
    // API/DB check: only the edited link remains.
    expect(find(await guide(page), location.id).links, 'API/DB: links saved').toEqual([{ label: 'Tide chart', url: 'https://example.com/tides' }]);
  });
});
