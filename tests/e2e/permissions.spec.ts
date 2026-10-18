import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createBoulder, editItem, deleteItem } from './testHelpers';
import { guide, deleteLocationsWithPrefix, deleteAccountsWithPrefix, cleanupAccounts, assertLocationRemovedFromDB, findRecord as find } from './apiTestHelpers';
import { createApiAccount, signIn, openPage, closeTabs, editGuide, uploadImage, seedLocation, type TestAccount } from './seedHelpers';

// Owner creates the content, other is a second contributor, admin can change anything; guest is signed out.
// Every user signs in once for the whole file: the app allows 20 logins per 10 minutes per IP.
const accountPrefix = 'test_perm_user_';
const prefix = 'test_perm_loc_';
type User = Awaited<ReturnType<typeof signIn>> & { account?: TestAccount };
let owner: User, other: User, admin: User, guest: User;
let seed: Awaited<ReturnType<typeof seedLocation>>;
const forbidden = 'You can only edit or remove your own submissions. Parent removal cannot delete other contributors’ submissions.';

test.beforeAll(async ({ browser }) => {
  // Create the accounts through the admin API and sign each in once.
  const [ownerAccount, otherAccount, adminAccount] = [await createApiAccount(accountPrefix), await createApiAccount(accountPrefix), await createApiAccount(accountPrefix, { admin: true })];
  owner = { ...await signIn(browser, ownerAccount), account: ownerAccount };
  other = { ...await signIn(browser, otherAccount), account: otherAccount };
  admin = { ...await signIn(browser, adminAccount), account: adminAccount };
  guest = await signIn(browser);
  // Shared read-only data: tests that change records seed their own location.
  seed = await seedLocation(owner.request, prefix);
});

// Close each test's tabs: open app tabs each hold a live-reload connection (see closeTabs).
test.afterEach(async () => { for (const user of [owner, other, admin, guest]) if (user) await closeTabs(user.context); });

test.afterAll(async ({}, info) => {
  // Only an admin can remove locations holding several users' content, so clean up as admin before deleting the accounts.
  if (admin) await deleteLocationsWithPrefix(admin.page, prefix, info);
  await deleteAccountsWithPrefix(accountPrefix, info);
  for (const user of [owner, other, admin, guest]) await user?.context.close();
});

/** Open a page in a new tab as the user; see openPage. */
const open = (user: User, ids: { location: string, boulder?: string, problem?: string }, heading: string) => openPage(user.context, ids, heading);

/**
 * Verify none of the named buttons are offered on the page.
 * @param page - Page to check.
 * @param names - Exact names or patterns of buttons that must be absent.
 */
async function expectNoButtons(page: Page, names: (string | RegExp)[]) {
  for (const name of names) await expect(page.getByRole('button', { name, exact: typeof name === 'string' }), 'No button: ' + name).toHaveCount(0);
}

/**
 * Verify each named button is offered on the page.
 * @param page - Page to check.
 * @param names - Exact names or patterns of buttons that must be present.
 */
async function expectButtons(page: Page, names: (string | RegExp)[]) {
  for (const name of names) await expect(page.getByRole('button', { name, exact: typeof name === 'string' }).first(), 'Button: ' + name).toBeVisible();
}


test('guest can browse but cannot contribute', async () => {
  await test.step('UI', async () => {
    // Open the seeded problem while signed out.
    const page = await open(guest, { location: seed.location.id, boulder: seed.boulder.id, problem: seed.problem.id }, 'V2 (5+) - Seed Problem');
    // Verify the content is readable.
    await expect(page.getByText('Climb the arete.', { exact: true })).toBeVisible();
    // Verify no edit controls are offered and contributing asks the guest to create an account.
    await expectNoButtons(page, ['Edit problem', 'Remove problem', 'Annotate', 'Remove photo']);
    const log = page.getByRole('button', { name: '+ Log problem', exact: true });
    await expect(log).toHaveAttribute('title', 'Create an account to contribute');
    await expect(log).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
  });

  await test.step('API', async () => {
    // Verify every write route refuses a signed-out request.
    const save = await editGuide(guest.request, g => { find(g, seed.location.id).name = 'Guest edit'; });
    expect(save.status(), 'Guest guide save is refused').toBe(401);
    for (const [route, type] of [['/api/images', 'image/png'], ['/api/videos', 'video/mp4']]) {
      const upload = await guest.request.post(route, { headers: { 'Content-Type': type }, data: Buffer.alloc(32) });
      expect(upload.status(), 'Guest upload to ' + route + ' is refused').toBe(401);
    }
  });
});

test("another user cannot edit or remove the owner's location, links or parking photos", async () => {
  await test.step('UI', async () => {
    // Open the owner's location as the other user.
    const page = await open(other, { location: seed.location.id }, seed.location.name);
    // Verify the owner's edit controls are not offered.
    await expectNoButtons(page, [/^Edit location/, 'Remove location', 'Edit links', 'Edit caption', 'Remove photo']);
    // Verify contributing beneath it is still offered.
    await expectButtons(page, ['+ Add boulder']);
  });

  await test.step('API', async () => {
    // Verify each kind of change to the owner's records is refused.
    const attempts: [string, (g: any) => void][] = [
      ['rename the location', g => { find(g, seed.location.id).name = 'Not yours'; }],
      ['change its links', g => { find(g, seed.location.id).links = []; }],
      ['change a parking photo caption', g => { find(g, seed.parking.id).caption = 'Not yours'; }],
      ['remove a parking photo', g => { find(g, seed.location.id).photos = []; }],
      ['remove the location', g => { g.locations = g.locations.filter((l: any) => l.id !== seed.location.id); }],
    ];
    for (const [name, change] of attempts) expect((await editGuide(other.request, change)).status(), 'Other user cannot ' + name).toBe(403);
    // API/DB check: the location is unchanged.
    const saved = find(await guide(owner.page), seed.location.id);
    expect(saved, 'API/DB: location is unchanged').toMatchObject({ name: seed.location.name, links: seed.location.links });
    expect(saved.photos, 'API/DB: parking photo is unchanged').toEqual([seed.parking]);
  });
});

test("another user cannot edit or remove the owner's boulder, photos or videos", async () => {
  await test.step('UI', async () => {
    // Open the owner's boulder as the other user.
    const page = await open(other, { location: seed.location.id, boulder: seed.boulder.id }, 'Seed Boulder');
    // Verify the owner's edit controls are not offered.
    await expectNoButtons(page, ['Edit boulder', 'Remove boulder', 'Remove image Seed photo', 'Remove video Seed video']);
  });

  await test.step('API', async () => {
    // Verify each kind of change to the owner's records is refused.
    const attempts: [string, (g: any) => void][] = [
      ['rename the boulder', g => { find(g, seed.boulder.id).name = 'Not yours'; }],
      ['remove a photo', g => { const b = find(g, seed.boulder.id); b.images = []; b.problems.forEach((p: any) => { p.imageIds = []; p.photoAnnotations = {}; }); }],
      ['remove a video', g => { const b = find(g, seed.boulder.id); b.videos = []; b.problems.forEach((p: any) => { p.videoIds = []; }); }],
      ['remove the boulder', g => { find(g, seed.location.id).boulders = []; }],
    ];
    for (const [name, change] of attempts) expect((await editGuide(other.request, change)).status(), 'Other user cannot ' + name).toBe(403);
    // API/DB check: the boulder and its media are unchanged.
    const saved = find(await guide(owner.page), seed.boulder.id);
    expect(saved, 'API/DB: boulder is unchanged').toMatchObject({ name: 'Seed Boulder', images: [seed.image], videos: [seed.video] });
  });
});

test("another user cannot edit the owner's problem, annotations or attachments", async () => {
  await test.step('UI', async () => {
    // Open the owner's problem as the other user.
    const page = await open(other, { location: seed.location.id, boulder: seed.boulder.id, problem: seed.problem.id }, 'V2 (5+) - Seed Problem');
    // Verify editing, annotating and attaching are not offered.
    await expectNoButtons(page, ['Edit problem', 'Remove problem', 'Annotate', 'Remove photo', /^\+ Add Photo/, /^\+ Add Video/]);
  });

  await test.step('API', async () => {
    // A photo the other user owns is still not theirs to attach to the owner's problem.
    const url = await uploadImage(other.request);
    const attempts: [string, (g: any) => void][] = [
      ['rename the problem', g => { find(g, seed.problem.id).name = 'Not yours'; }],
      ['change its annotations', g => { find(g, seed.problem.id).photoAnnotations = {}; }],
      ['unlink a photo', g => { find(g, seed.problem.id).imageIds = []; }],
      ['unlink a video', g => { find(g, seed.problem.id).videoIds = []; }],
      ['attach their own photo', g => {
        const image = { id: crypto.randomUUID(), name: 'Other photo', caption: '', url, annotations: [] };
        find(g, seed.boulder.id).images.push(image);
        find(g, seed.problem.id).imageIds.push(image.id);
      }],
      ['remove the problem', g => { find(g, seed.boulder.id).problems = []; }],
    ];
    for (const [name, change] of attempts) expect((await editGuide(other.request, change)).status(), 'Other user cannot ' + name).toBe(403);
    // API/DB check: the problem is unchanged, and the refused save added no photo.
    const saved = await guide(owner.page);
    expect(find(saved, seed.problem.id), 'API/DB: problem is unchanged').toEqual(seed.problem);
    expect(find(saved, seed.boulder.id).images, 'API/DB: no photo was added').toEqual([seed.image]);
  });
});

test("another user can add to the owner's location and manage their own additions", async () => {
  const { location, boulder: ownerBoulder } = await seedLocation(owner.request, prefix, { media: false });

  const boulder = await test.step('UI: add, then edit their own boulder', async () => {
    // Create a boulder in the owner's location through the UI as the other user.
    const page = await other.context.newPage();
    const boulder = await createBoulder(page, location);
    // Verify they are credited and offered their own edit controls.
    await expect(page.locator('.detail-banner .created-by')).toContainText(other.account!.name);
    await expectButtons(page, ['Edit boulder', 'Remove boulder']);
    // Edit it and verify the change is saved.
    await editItem(page, 'boulder', { name: 'Other user boulder' });
    return boulder;
  });

  await test.step("API: add to and remove from the owner's boulder", async () => {
    // Add a problem with their own photo beneath the owner's boulder.
    const url = await uploadImage(other.request);
    const image = { id: crypto.randomUUID(), name: 'Other photo', caption: '', url, annotations: [] };
    const problem = { id: crypto.randomUUID(), name: 'Other problem', grade: 'V3 (6A/6A+)', description: 'Their line.', imageIds: [image.id], videoIds: [] };
    const added = await editGuide(other.request, g => { const b = find(g, ownerBoulder.id); b.images.push(image); b.problems.push(problem); });
    expect(added.status(), 'Other user can add a photo and problem to the owner\'s boulder').toBe(200);
    // API/DB check: both are credited to the other user.
    const saved = await added.json();
    expect(find(saved, problem.id), 'API/DB: problem credited to its creator').toMatchObject({ createdBy: other.account!.id });
    expect(find(saved, image.id), 'API/DB: photo credited to its creator').toMatchObject({ createdBy: other.account!.id });
    // They can remove their own additions.
    const removed = await editGuide(other.request, g => { const b = find(g, ownerBoulder.id); b.problems = b.problems.filter((p: any) => p.id !== problem.id); b.images = b.images.filter((i: any) => i.id !== image.id); });
    expect(removed.status(), 'Other user can remove their own additions').toBe(200);
  });

  await test.step("API: the owner cannot edit the other user's boulder", async () => {
    const response = await editGuide(owner.request, g => { find(g, boulder.id).name = 'Owner edit'; });
    expect(response.status(), 'Location owner cannot edit a boulder they did not create').toBe(403);
  });
});

test('the owner can edit and remove their own records', async () => {
  const { location, boulder, problem, image, video } = await seedLocation(owner.request, prefix);

  await test.step('UI', async () => {
    // Verify the owner is offered every edit control on their location, boulder and problem.
    await expectButtons(await open(owner, { location: location.id }, location.name), [/^Edit location/, 'Remove location', 'Edit links', 'Edit caption', 'Remove photo']);
    await expectButtons(await open(owner, { location: location.id, boulder: boulder.id }, 'Seed Boulder'), ['Edit boulder', 'Remove boulder', 'Remove image Seed photo', 'Remove video Seed video']);
    await expectButtons(await open(owner, { location: location.id, boulder: boulder.id, problem: problem.id }, 'V2 (5+) - Seed Problem'), ['Edit problem', 'Remove problem', 'Annotate', 'Remove photo', /^\+ Add Photo/, /^\+ Add Video/]);
  });

  await test.step('API', async () => {
    // Verify each kind of change the other user was refused succeeds for the owner.
    const marks = [{ type: 'line', color: 'red', x: 10, y: 10, x2: 500, y2: 500 }];
    const changes: [string, (g: any) => void][] = [
      ['rename the location', g => { find(g, location.id).name = location.name + '_edited'; }],
      ['change a parking photo caption', g => { find(g, location.photos[0].id).caption = 'Owner caption'; }],
      ['change annotations', g => { find(g, problem.id).photoAnnotations = { [image.id]: marks }; }],
      ['unlink a video', g => { find(g, problem.id).videoIds = []; }],
      ['remove a video', g => { find(g, boulder.id).videos = []; }],
    ];
    for (const [name, change] of changes) expect((await editGuide(owner.request, change)).status(), 'Owner can ' + name).toBe(200);
    // API/DB check: the changes were saved.
    const saved = await guide(owner.page);
    expect(find(saved, problem.id).photoAnnotations[image.id], 'API/DB: annotations saved').toEqual(marks);
    expect(find(saved, video.id), 'API/DB: video removed').toBeUndefined();
  });
});

test("the owner cannot remove a boulder containing another user's problem", async () => {
  const { location, boulder } = await seedLocation(owner.request, prefix, { media: false });
  // The other user adds a problem beneath the owner's boulder.
  const problem = { id: crypto.randomUUID(), name: 'Other problem', grade: 'V3 (6A/6A+)', description: 'Their line.', imageIds: [], videoIds: [] };
  expect((await editGuide(other.request, g => { find(g, boulder.id).problems.push(problem); })).status(), 'Other user adds a problem').toBe(200);

  // Try to remove the boulder through the UI as its owner.
  const page = await open(owner, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  await page.getByRole('button', { name: 'Remove boulder', exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove boulder', exact: true }).click();
  // Verify the server refused it and the dialog explains why.
  expect((await saved).status(), 'Removing a boulder with another user\'s problem is refused').toBe(403);
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(forbidden);
  // API/DB check: the boulder and the other user's problem remain.
  expect(find(await guide(owner.page), problem.id), 'API/DB: other user\'s problem remains').toBeDefined();
});

test('an admin can edit and remove anything', async () => {
  const { location, boulder } = await seedLocation(owner.request, prefix, { media: false });
  // The other user adds a boulder, so the location holds two users' content.
  const otherBoulder = { id: crypto.randomUUID(), name: 'Other boulder', notes: 'Their directions.', otherNotes: '', images: [], videos: [], problems: [] };
  expect((await editGuide(other.request, g => { find(g, location.id).boulders.push(otherBoulder); })).status(), 'Other user adds a boulder').toBe(200);

  await test.step('API: edit both users\' records', async () => {
    const response = await editGuide(admin.request, g => { find(g, boulder.id).name = 'Admin edit'; find(g, otherBoulder.id).name = 'Admin edit too'; });
    expect(response.status(), 'Admin can edit any user\'s records').toBe(200);
  });

  await test.step('UI: remove the whole location', async () => {
    // Verify the admin is offered the owner's controls, then remove the location.
    const page = await open(admin, { location: location.id }, location.name);
    await expectButtons(page, [/^Edit location/, 'Remove location']);
    await deleteItem(page, 'location');
    // API/DB check: the location and both users' boulders are gone.
    await assertLocationRemovedFromDB(admin.page, location.id);
  });
});

test("a deleted user's content is credited to Deleted User and only an admin can change it", async ({ browser }) => {
  const { location } = await seedLocation(owner.request, prefix, { media: false });
  // A temporary account adds a boulder, then deletes their account (as the app does: content is kept, ownerless).
  const goneAccount = await createApiAccount('test_perm_gone_');
  const gone = await signIn(browser, goneAccount);
  const boulder = { id: crypto.randomUUID(), name: 'Orphaned boulder', notes: 'Left behind.', otherNotes: '', images: [], videos: [], problems: [] };
  try {
    expect((await editGuide(gone.request, g => { find(g, location.id).boulders.push(boulder); })).status(), 'Boulder added').toBe(200);
  } finally { await gone.context.close(); }
  await cleanupAccounts('test_perm_gone_');
  // The boulder remains, credited to Deleted User, with no link to a profile.
  const page = await open(owner, { location: location.id, boulder: boulder.id }, 'Orphaned boulder');
  await expect(page.locator('.detail-banner .created-by')).toHaveText('Created by Deleted User');
  await expect(page.locator('.detail-banner .created-by').getByRole('link')).toHaveCount(0);
  // The location's owner can't edit it; an admin can.
  await expectNoButtons(page, ['Edit boulder', 'Remove boulder']);
  expect((await editGuide(owner.request, g => { find(g, boulder.id).name = 'Owner edit'; })).status(), "Location owner can't edit it").toBe(403);
  expect((await editGuide(admin.request, g => { find(g, boulder.id).name = 'Admin edit'; })).status(), 'Admin can edit it').toBe(200);
});
