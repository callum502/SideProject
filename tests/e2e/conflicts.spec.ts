import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation, editGuide } from './seedHelpers';

// Two tabs stand in for two people: each keeps the guide it loaded until it saves or reloads.
const prefix = 'test_conflict_loc_';
const user = testUser('test_conflict_user_', prefix);
const conflict = 'Someone else changed this while you were editing. Reload before saving again.';

/** Submit the open dialog and return the save's HTTP status. */
async function submit(page: Page, label: string) {
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  return (await saved).status();
}

test('saves from out-of-date tabs succeed when they change different records', async () => {
  const { location } = await seedLocation(user.current.request, prefix, { media: false });
  const first = await openPage(user.current.context, { location: location.id }, location.name);
  const second = await openPage(user.current.context, { location: location.id }, location.name);
  // The first tab changes the location's approach notes.
  await first.getByRole('button', { name: /^Edit location/ }).click();
  await first.getByRole('dialog').getByLabel(/^Approach notes/).fill('Updated in the first tab.');
  expect(await submit(first, 'Save location'), 'First tab saves').toBe(200);
  // The second tab still shows the old notes, and adds a boulder.
  await expect(second.getByText('Follow the seeded path.', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: /Add boulder/ }).click();
  const dialog = second.getByRole('dialog');
  await dialog.locator('[name="name"]').fill('Second tab boulder');
  await dialog.locator('[name="notes"]').fill('Added while out of date.');
  expect(await submit(second, 'Save boulder'), 'Out-of-date second tab still saves').toBe(200);
  // The save brings the second tab up to date, with the first tab's change kept.
  await second.getByRole('link', { name: location.name }).first().click();
  await expect(second.getByText('Updated in the first tab.', { exact: true })).toBeVisible();
  // API/DB check: both changes were saved.
  const saved = find(await guide(second), location.id);
  expect(saved.approach, 'API/DB: first tab\'s change kept').toBe('Updated in the first tab.');
  expect(saved.boulders.map((b: any) => b.name), 'API/DB: second tab\'s boulder added').toContain('Second tab boulder');
});

test('an out-of-date edit to the same record is refused until the tab reloads', async () => {
  const { location } = await seedLocation(user.current.request, prefix, { media: false });
  const first = await openPage(user.current.context, { location: location.id }, location.name);
  const second = await openPage(user.current.context, { location: location.id }, location.name);
  // Both tabs open the same location's edit form; the first saves.
  for (const page of [first, second]) await page.getByRole('button', { name: /^Edit location/ }).click();
  await first.getByRole('dialog').getByLabel(/^Location name/).fill(location.name + '_first');
  expect(await submit(first, 'Save location'), 'First tab saves').toBe(200);
  // The second tab's save would overwrite that change, so it is refused with an explanation.
  await second.getByRole('dialog').getByLabel(/^Location name/).fill(location.name + '_second');
  expect(await submit(second, 'Save location'), 'Out-of-date edit is refused').toBe(409);
  await expect(second.getByRole('dialog').getByRole('alert')).toHaveText(conflict);
  expect(find(await guide(second), location.id).name, 'API/DB: first tab\'s name kept').toBe(location.name + '_first');
  // After reloading, the second tab sees the new name and can edit it.
  await second.reload();
  await expect(second.locator('.detail-banner').getByRole('heading', { name: location.name + '_first', exact: true })).toBeVisible();
  await second.getByRole('button', { name: /^Edit location/ }).click();
  await second.getByRole('dialog').getByLabel(/^Location name/).fill(location.name + '_second');
  expect(await submit(second, 'Save location'), 'Reloaded tab saves').toBe(200);
  expect(find(await guide(second), location.id).name, 'API/DB: reloaded tab\'s name saved').toBe(location.name + '_second');
});

test('removing a boulder is refused if it gained a problem the tab has not seen', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  // Someone else adds a problem after the tab loaded.
  const problem = { id: crypto.randomUUID(), name: 'Newer problem', grade: 'V1 (5)', description: 'Added meanwhile.', imageIds: [], videoIds: [] };
  expect((await editGuide(user.current.request, g => find(g, boulder.id).problems.push(problem))).status(), 'Problem added elsewhere').toBe(200);
  // Removing the boulder from the out-of-date tab would silently delete it, so it is refused.
  await page.getByRole('button', { name: 'Remove boulder', exact: true }).click();
  expect(await submit(page, 'Remove boulder'), 'Removal is refused').toBe(409);
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(conflict);
  // API/DB check: the boulder and the newer problem remain.
  expect(find(await guide(page), problem.id), 'API/DB: newer problem kept').toBeDefined();
});
