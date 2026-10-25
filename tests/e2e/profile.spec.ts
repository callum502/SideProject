import { test, expect } from './fixtures';
import type { BrowserContext } from '@playwright/test';
import {
  testUser,
  openPage,
  seedLocation,
  uploadImage,
  uploadBytes,
  createApiAccount,
  signIn,
  logProblem,
  befriend,
  friendsAction,
  editGuide,
  type User,
} from './seedHelpers';
import { deleteAccount } from './testHelpers';
import { guide, findRecord as find, deleteAccountsWithPrefix } from './apiTestHelpers';
import { mediaFile } from './media';

const prefix = 'test_profile_loc_';
const owner = testUser('test_profile_user_', prefix);
const visitor = testUser('test_profile_visitor_', 'test_profile_visitor_loc_');
// Accounts for the delete-and-recreate test, which deletes one of them itself.
const gonePrefix = 'test_profile_gone_',
  goneLocations = 'test_profile_gone_loc_';
test.afterAll(async ({}, info) => {
  await deleteAccountsWithPrefix(gonePrefix, info);
});

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
  await page
    .locator('label', { hasText: 'Upload profile photo' })
    .locator('input[type="file"]')
    .setInputFiles([mediaFile('jpg')]);
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
  for (const file of [
    { name: 'me.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
    { name: 'me.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) },
  ]) {
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
  for (const name of ['Delete account', 'Remove profile photo'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit profile', exact: true })).toHaveCount(0);
  await expect(page.locator('label', { hasText: 'Upload profile photo' })).toHaveCount(0);
  await expect(page.getByText(/^Uploads:/)).toHaveCount(0);
});

test('editing the profile refuses a blank or taken display name, and keeps your own', async () => {
  const page = await openProfile(owner.current.context, owner.current.account.id, owner.current.account.name);
  await page.getByRole('link', { name: 'Edit profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
  const name = page.locator('input[name="name"]'),
    save = page.getByRole('button', { name: 'Save profile', exact: true });
  // Only spaces passes the browser's required check, so the server refuses it.
  await name.fill('   ');
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Enter a display name');
  // Another user's name, in any case, is taken.
  await name.fill(visitor.current.account.name.toUpperCase());
  await save.click();
  await expect(page.getByRole('alert')).toHaveText('That display name is already taken. Choose a different name.');
  // Keeping your own name is fine.
  await name.fill(owner.current.account.name);
  const saved = page.waitForResponse(r => r.url().endsWith('/api/profile') && r.request().method() === 'POST');
  await save.click();
  expect((await saved).status(), 'Own name saved').toBe(200);
  await expect(page).toHaveURL(/#explore$/);
});

test("a profile photo's contents are checked, and a new photo replaces the old one", async () => {
  const { id, name } = owner.current.account;
  const page = await openProfile(owner.current.context, id, name);
  const input = page.locator('label', { hasText: 'Upload profile photo' }).locator('input[type="file"]');
  // A file named and typed as PNG that isn't an image is refused by the server.
  await input.setInputFiles([{ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from('not really an image') }]);
  await expect(page.getByRole('alert')).toHaveText('The file is not a supported image.');
  expect(await photoStatus(id), 'API: no photo saved').toBe(404);
  // Skipping the app's check doesn't help: the server reads the stored file's contents first.
  const fake = await uploadBytes(owner.current.request, Buffer.from('not really an image'), 'image/png');
  const refused = await owner.current.request.post('/api/profile-photo', { data: { url: fake } });
  expect({ status: refused.status(), error: (await refused.json()).error }, 'API: disguised photo refused').toEqual({
    status: 400,
    error: 'The file is not a supported image.',
  });
  expect(await photoStatus(id), 'API: still no photo saved').toBe(404);
  // A second photo replaces the first.
  const photoUrl = async () =>
    (await owner.current.request.get('/api/profile-photo?id=' + id, { maxRedirects: 0 })).headers().location;
  await input.setInputFiles([mediaFile('jpg')]);
  await expect.poll(photoUrl, { message: 'First photo saved' }).toMatch(/\.jpg$/);
  await input.setInputFiles([mediaFile('png')]);
  await expect.poll(photoUrl, { message: 'Second photo replaced it' }).toMatch(/\.png$/);
  await page.getByRole('button', { name: 'Remove profile photo', exact: true }).click();
  await expect.poll(() => photoStatus(id)).toBe(404);
});

test("a new account reusing a deleted account's display name inherits none of its data", async ({ browser }) => {
  const users: User[] = [];
  const open = async (account: Awaited<ReturnType<typeof createApiAccount>>) => {
    const user = { ...(await signIn(browser, account)), account };
    users.push(user);
    return user;
  };
  const admin = await open(await createApiAccount(gonePrefix, { admin: true }));
  const old = await open(await createApiAccount(gonePrefix));
  const friend = await open(await createApiAccount(gonePrefix));
  let locationId: string | undefined;
  try {
    // The old account has a profile photo, a location, a logged climb and a friend.
    const photo = await uploadImage(old.request, 'jpg');
    expect((await old.request.post('/api/profile-photo', { data: { url: photo } })).status(), 'Profile photo set').toBe(
      200
    );
    const { location, problem } = await seedLocation(old.request, goneLocations, { media: false });
    locationId = location.id;
    await logProblem(old.request, problem.id);
    await befriend(old, friend);
    // It is deleted from its profile page.
    const page = await old.context.newPage();
    await page.goto('/#user=' + old.account.id);
    await deleteAccount(page);
    // A new account takes the same display name.
    const fresh = await open(await createApiAccount(gonePrefix, { name: old.account.name }));
    expect(fresh.account.id, 'A different account').not.toBe(old.account.id);
    // None of the old account's data carries over.
    expect(
      (await fresh.request.get('/api/profile-photo?id=' + fresh.account.id, { maxRedirects: 0 })).status(),
      'No profile photo'
    ).toBe(404);
    expect(await (await fresh.request.get('/api/logbook')).json(), 'Empty logbook').toEqual([]);
    expect(await (await friendsAction(fresh.request, 'list')).json(), 'No friends or invites').toEqual([]);
    expect(
      await (await friendsAction(friend.request, 'list')).json(),
      "The old account's friend has no friendship left"
    ).toEqual([]);
    expect((await (await fresh.request.get('/api/storage/usage')).json()).usedBytes, 'No storage used').toBe(0);
    expect(
      await (await fresh.request.get('/api/public-profile?id=' + fresh.account.id)).json(),
      'A blank public profile'
    ).toMatchObject({ name: old.account.name, entries: [], hasPhoto: false });
    // The old account's location stays, credited to Deleted User, and the new account can't edit it.
    expect(find(await guide(fresh.page), location.id), 'Location credited to Deleted User').toMatchObject({
      createdBy: null,
      createdByName: 'Deleted User',
    });
    expect(
      (
        await editGuide(fresh.request, g => {
          find(g, location.id).name = goneLocations + 'claimed';
        })
      ).status(),
      "New account can't edit it"
    ).toBe(403);
    // Searching the name finds only the new account, and the old profile link is gone.
    expect(
      (await (await friendsAction(friend.request, 'suggest', { name: old.account.name })).json()).map((p: any) => p.id),
      'Only the new account matches'
    ).toEqual([fresh.account.id]);
    expect(
      (await fresh.request.get('/api/public-profile?id=' + old.account.id)).status(),
      'Old profile not found'
    ).toBe(404);
    const oldProfile = await fresh.context.newPage();
    await oldProfile.goto('/#user=' + old.account.id);
    await expect(oldProfile.getByRole('alert')).toHaveText('Profile not found.');
  } finally {
    // Only an admin can remove a location whose owner was deleted.
    if (locationId)
      await editGuide(admin.request, g => {
        g.locations = g.locations.filter((l: any) => l.id !== locationId);
      });
    for (const user of users) await user.context.close();
  }
});

// Regression: the profile page uploads the image first and sets it as the profile photo second. If the second step
// failed, the uploaded file used to stay in Storage, counting towards the allowance; it is now discarded.
test('a profile photo that fails to save leaves no file behind', async () => {
  const { id, name } = owner.current.account;
  const page = await openProfile(owner.current.context, id, name);
  const usedBytes = async () =>
    (await (await owner.current.request.get('/api/storage/usage')).json()).usedBytes as number;
  const before = await usedBytes();
  await page.route('**/api/profile-photo', route =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { error: 'Could not save photo.' } })
      : route.fallback()
  );
  await page
    .locator('label', { hasText: 'Upload profile photo' })
    .locator('input[type="file"]')
    .setInputFiles([mediaFile('png')]);
  await expect(page.getByRole('alert')).toHaveText('Could not save photo.');
  expect(await photoStatus(id), 'No profile photo set').toBe(404);
  // The upload is discarded just after the error is shown.
  await expect.poll(usedBytes, { message: 'No file was left behind', timeout: 5000 }).toBe(before);
});

/** Every object key in a JSON value, at any depth. */
const keysOf = (value: any): string[] =>
  value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) => [...(Array.isArray(value) ? [] : [key]), ...keysOf(child)])
    : [];

test('no response about another user reveals their email or role', async () => {
  const [o, v] = [owner.current, visitor.current];
  await befriend(o, v);
  try {
    const { problem } = await seedLocation(o.request, prefix, { media: false });
    await logProblem(o.request, problem.id);
    // Everything the visitor can read about the owner.
    const responses: [string, Promise<any>][] = [
      ['public profile', v.request.get('/api/public-profile?id=' + o.account.id).then(r => r.json())],
      ['friend search', friendsAction(v.request, 'suggest', { name: o.account.name }).then(r => r.json())],
      ['friends list', friendsAction(v.request, 'list').then(r => r.json())],
      ["friend's logbook", friendsAction(v.request, 'logbook', { target: o.account.id }).then(r => r.json())],
      ['guide', v.request.get('/api/guide').then(r => r.json())],
    ];
    for (const [what, response] of responses) {
      const body = await response;
      expect.soft(JSON.stringify(body), what + ': no email').not.toContain(o.account.email);
      expect
        .soft(
          keysOf(body).filter(key => /^(email|role)$/i.test(key)),
          what + ': no email or role fields'
        )
        .toEqual([]);
    }
  } finally {
    await friendsAction(o.request, 'remove', { target: v.account.id });
  }
});

const renamePrefix = 'test_profile_rename_';
test.afterAll(async ({}, info) => {
  await deleteAccountsWithPrefix(renamePrefix, info);
});

test('a new display name shows on everything the user made and wherever others see them', async ({ browser }) => {
  const users: User[] = [];
  const open = async () => {
    const account = await createApiAccount(renamePrefix);
    const user = { ...(await signIn(browser, account)), account };
    users.push(user);
    return user;
  };
  const [climber, friend] = [await open(), await open()];
  const oldName = climber.account.name,
    newName = renamePrefix + 'renamed_' + crypto.randomUUID().slice(0, 8);
  let locationId: string | undefined;
  try {
    await befriend(climber, friend);
    const { location } = await seedLocation(climber.request, renamePrefix + 'loc_', { media: false });
    locationId = location.id;
    // The climber renames themselves on their profile.
    const page = await climber.context.newPage();
    await page.goto('/#details');
    await page.locator('input[name="name"]').fill(newName);
    const saved = page.waitForResponse(r => r.url().endsWith('/api/profile') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    expect((await saved).status(), 'Profile saved').toBe(200);
    // Their friend sees the new name as the location's creator and in their friends list.
    const location_ = await openPage(friend.context, { location: location.id }, location.name);
    await expect(location_.locator('.detail-banner .created-by').getByRole('link')).toContainText(newName);
    const friends = await friend.context.newPage();
    await friends.goto('/#friends');
    await expect(
      friends.locator('section').filter({ has: friends.getByRole('heading', { name: /^Your friends/ }) })
    ).toContainText(newName);
    // Search finds the new name, and the old name finds no one.
    const search = async (name: string) =>
      (await (await friendsAction(friend.request, 'suggest', { name })).json()).map((p: any) => p.id);
    expect(await search(newName), 'Found by the new name').toEqual([climber.account.id]);
    expect(await search(oldName), 'The old name finds no one').toEqual([]);
    expect(find(await guide(friend.page), location.id).createdByName, 'API/DB: creator name updated').toBe(newName);
  } finally {
    // Remove the location before the accounts are deleted, while its creator still can.
    if (locationId)
      await editGuide(climber.request, g => {
        g.locations = g.locations.filter((l: any) => l.id !== locationId);
      });
    for (const user of users) await user.context.close();
  }
});

test('replacing or removing a profile photo deletes the old file, unless the guide still uses it', async () => {
  const { id, name } = owner.current.account;
  const request = owner.current.request;
  const usedBytes = async () => (await (await request.get('/api/storage/usage')).json()).usedBytes as number;
  const photoFile = async () =>
    (await request.get('/api/profile-photo?id=' + id, { maxRedirects: 0 })).headers().location;
  const reachable = async (url: string) => (await request.get(url)).status() === 200;
  const before = await usedBytes();
  const page = await openProfile(owner.current.context, id, name);
  const input = page.locator('label', { hasText: 'Upload profile photo' }).locator('input[type="file"]');
  // Replacing the photo deletes the first file.
  await input.setInputFiles([mediaFile('jpg')]);
  await expect.poll(photoFile).toMatch(/\.jpg$/);
  const first = (await photoFile())!;
  await input.setInputFiles([mediaFile('png')]);
  await expect.poll(photoFile).toMatch(/\.png$/);
  const second = (await photoFile())!;
  // The server deletes the old file just after saving the new photo, in the same request, so wait for it.
  await expect.poll(() => reachable(first), { message: 'The replaced photo file was deleted' }).toBe(false);
  // Removing the photo deletes its file too, so storage is back where it started.
  await page.getByRole('button', { name: 'Remove profile photo', exact: true }).click();
  await expect.poll(() => photoStatus(id)).toBe(404);
  await expect.poll(() => reachable(second), { message: 'The removed photo file was deleted' }).toBe(false);
  expect(await usedBytes(), 'Storage freed').toBe(before);
  // A guide photo used as the profile photo keeps its file when the profile photo changes.
  const { image } = await seedLocation(request, prefix);
  expect(
    (await request.post('/api/profile-photo', { data: { url: image.url } })).status(),
    'Guide photo set as profile photo'
  ).toBe(200);
  expect((await request.post('/api/profile-photo', { data: { url: null } })).status(), 'Profile photo removed').toBe(
    200
  );
  expect(await reachable(image.url), 'The guide photo is kept').toBe(true);
});
