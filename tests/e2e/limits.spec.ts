import { test, expect } from './fixtures';
import { guide, findRecord as find } from './apiTestHelpers';
import { locationName, chooseFiles, completeUpload, dialogError } from './testHelpers';
import { testUser, openPage, seedLocation, editGuide, uploadImage, runSql, uuid, type User } from './seedHelpers';
import { mediaFile } from './media';

// Each limit test uses its own account, so filling one user's allowance doesn't affect the other tests.
// Location prefixes must not start with one another: each account can only clean up its own.
const prefix = 'test_limits_l_',
  boulderPrefix = 'test_limits_b_',
  problemPrefix = 'test_limits_p_',
  mediaPrefix = 'test_limits_m_';
const locations = testUser('test_limits_loc_user_', prefix);
const boulders = testUser('test_limits_boulder_user_', boulderPrefix);
const problems = testUser('test_limits_problem_user_', problemPrefix);
const media = testUser('test_limits_media_user_', mediaPrefix);
const quotaPrefix = 'test_limits_q_';
const quota = testUser('test_limits_quota_user_', quotaPrefix);

const newLocation = (name: string) => ({
  id: crypto.randomUUID(),
  name,
  latitude: '56.8',
  longitude: '-3.2',
  approach: 'Limit test.',
  links: [],
  photos: [],
  boulders: [],
});
const newBoulder = () => ({
  id: crypto.randomUUID(),
  name: 'Limit boulder',
  notes: 'Limit test.',
  otherNotes: '',
  images: [],
  videos: [],
  problems: [],
});
const newProblem = () => ({
  id: crypto.randomUUID(),
  name: 'Limit problem',
  grade: 'V1 (5)',
  description: 'Limit test.',
  imageIds: [],
  videoIds: [],
});

/** Save a change as the user and return the status and error message. */
async function attempt(user: User, change: (g: any) => void) {
  const response = await editGuide(user.request, change);
  return { status: response.status(), error: response.ok() ? undefined : (await response.json()).error };
}

test('a user can create at most 25 locations', async () => {
  const user = locations.current;
  expect(
    (
      await attempt(user, g => {
        for (let i = 0; i < 25; i++) g.locations.push(newLocation(locationName(prefix)));
      })
    ).status,
    '25 locations allowed'
  ).toBe(200);
  // The 26th is refused through the API...
  expect(await attempt(user, g => g.locations.push(newLocation(locationName(prefix)))), 'API: 26th refused').toEqual({
    status: 400,
    error: 'You already have the maximum 25 locations. Remove one before creating another.',
  });
  // ...and through the Create location form.
  const page = await user.context.newPage();
  await page.goto('/#explore');
  await page.getByRole('button', { name: /Create location/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Location name/).fill(locationName(prefix));
  await dialog.getByLabel('Latitude').fill('56.8');
  await dialog.getByLabel('Longitude').fill('-3.2');
  await dialog.getByLabel(/^Approach notes/).fill('One too many.');
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'You already have the maximum 25 locations. Remove one before creating another.'
  );
});

test('a user can create at most 50 boulders', async () => {
  const user = boulders.current;
  const { location } = await seedLocation(user.request, boulderPrefix, { media: false });
  // The seeded location already has one boulder.
  expect(
    (
      await attempt(user, g => {
        for (let i = 0; i < 49; i++) find(g, location.id).boulders.push(newBoulder());
      })
    ).status,
    '50 boulders allowed'
  ).toBe(200);
  expect(await attempt(user, g => find(g, location.id).boulders.push(newBoulder())), 'API: 51st refused').toEqual({
    status: 400,
    error: 'You already have the maximum 50 boulders. Remove one before creating another.',
  });
});

test('a user can create at most 250 problems', async () => {
  const user = problems.current;
  const { boulder } = await seedLocation(user.request, problemPrefix, { media: false });
  // The seeded boulder already has one problem.
  expect(
    (
      await attempt(user, g => {
        for (let i = 0; i < 249; i++) find(g, boulder.id).problems.push(newProblem());
      })
    ).status,
    '250 problems allowed'
  ).toBe(200);
  expect(await attempt(user, g => find(g, boulder.id).problems.push(newProblem())), 'API: 251st refused').toEqual({
    status: 400,
    error: 'You already have the maximum 250 problems. Remove one before creating another.',
  });
});

test('a location can hold at most 50 photos and videos', async () => {
  test.setTimeout(120000);
  const user = media.current;
  const message =
    'This location has a maximum of 50 photos and videos combined, including parking photos. Remove an existing photo or video before adding more.';
  // The seeded location has a parking photo, a boulder photo and a video: add 47 more boulder photos.
  const { location, boulder } = await seedLocation(user.request, mediaPrefix);
  const images = [];
  for (let i = 0; i < 47; i++)
    images.push({
      id: crypto.randomUUID(),
      name: 'Limit photo ' + i,
      caption: '',
      url: await uploadImage(user.request),
      annotations: [],
    });
  expect((await attempt(user, g => find(g, boulder.id).images.push(...images))).status, '50 media allowed').toBe(200);
  // One more is refused through the API...
  const url = await uploadImage(user.request);
  expect(
    await attempt(user, g =>
      find(g, location.id).photos.push({
        id: crypto.randomUUID(),
        name: 'One too many',
        caption: '',
        url,
        annotations: [],
      })
    ),
    'API: 51st refused'
  ).toEqual({ status: 400, error: message });
  // ...and the page refuses before uploading.
  const page = await openPage(user.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
  await chooseFiles(page, '+ Upload images', [mediaFile('png')]);
  await expect(page.getByRole('alert')).toContainText(message);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Removing a photo frees a slot, and the next upload succeeds.
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.getByRole('button', { name: 'Remove image Limit photo 0', exact: true }).click();
  const removed = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  expect((await removed).status(), 'Photo removed').toBe(200);
  await chooseFiles(page, '+ Upload images', [mediaFile('png')]);
  await completeUpload(page, { names: ['Freed slot'] });
  expect(
    find(await guide(page), boulder.id).images.map((i: any) => i.name),
    'API/DB: the new photo took the freed slot'
  ).toContain('Freed slot');
});

test('uploads stop at the 10 GB storage allowance', async () => {
  const user = quota.current;
  const { location, boulder } = await seedLocation(user.request, quotaPrefix, { media: false });
  // Filling 10 GB for real isn't practical: set the account's recorded usage to just under the limit.
  runSql(`INSERT INTO private.user_storage_usage(user_id, used_bytes) VALUES ('${uuid(user.account.id)}', 9999999000)
    ON CONFLICT (user_id) DO UPDATE SET used_bytes = EXCLUDED.used_bytes`);
  try {
    const message = 'This upload would exceed your 10 GB upload allowance.';
    // The API refuses the upload...
    const response = await user.request.post('/api/images', {
      headers: { 'Content-Type': 'image/png' },
      data: mediaFile('png').buffer,
    });
    expect({ status: response.status(), error: (await response.json()).error }, 'API: upload refused').toEqual({
      status: 400,
      error: message,
    });
    // ...the upload dialog explains it...
    const page = await openPage(user.context, { location: location.id, boulder: boulder.id }, 'Seed Boulder');
    await chooseFiles(page, '+ Upload images', [mediaFile('png')]);
    await dialogError(page, 'Upload', message);
    // ...and the profile shows the allowance as full.
    await page.goto('/#user=' + user.account.id);
    await expect(page.getByText('Uploads: 10.00 GB of 10 GB', { exact: true })).toBeVisible();
  } finally {
    runSql(`DELETE FROM private.user_storage_usage WHERE user_id = '${uuid(user.account.id)}'`);
  }
});

test('names and notes over their length limits are refused', async () => {
  // The forms cap these lengths; the API enforces them for any client. The media test's account has posts to spare.
  const user = media.current;
  const { location } = await seedLocation(user.request, mediaPrefix, { media: false });
  const cases: [string, (g: any) => void, string][] = [
    [
      'location name',
      g => {
        find(g, location.id).name = prefix + 'x'.repeat(80);
      },
      'Location name must be no more than 80 characters.',
    ],
    [
      'boulder notes',
      g => {
        find(g, location.id).boulders[0].notes = 'x'.repeat(801);
      },
      'Finding the Boulder must be no more than 800 characters.',
    ],
    [
      'problem description',
      g => {
        find(g, location.id).boulders[0].problems[0].description = 'x'.repeat(801);
      },
      'Problem description must be no more than 800 characters.',
    ],
  ];
  for (const [what, change, error] of cases)
    expect(await attempt(user, change), 'API: long ' + what + ' refused').toEqual({ status: 400, error });
});
