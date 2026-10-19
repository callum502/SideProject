import { test, expect } from './fixtures';
import { findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation, editGuide, logProblem } from './seedHelpers';

const prefix = 'test_logbook_loc_';
const climber = testUser('test_logbook_user_', prefix);
// A second account views the climber's public logbook.
const viewer = testUser('test_logbook_viewer_', 'test_logbook_viewer_loc_');
const entryName = 'V2 (5+) - Seed Problem';

/** Open a user's profile page and wait for it to load. */
async function openProfile(context: any, id: string, name: string) {
  const page = await context.newPage();
  await page.goto('/#user=' + encodeURIComponent(id));
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  return page;
}

test('logging a problem marks it done and adds it to the logbook; unlogging reverses both', async () => {
  const { location, boulder, problem } = await seedLocation(climber.current.request, prefix, { media: false });
  const page = await openPage(climber.current.context, { location: location.id, boulder: boulder.id, problem: problem.id }, entryName);
  // Log the problem.
  await page.getByRole('button', { name: '+ Log problem', exact: true }).click();
  const unlog = page.getByRole('button', { name: '− Remove from logbook', exact: true });
  await expect(unlog).toBeVisible();
  // The boulder's problem list marks it done.
  await page.getByRole('link', { name: /^Boulder/ }).click();
  await expect(page.locator('.problem-row').filter({ hasText: 'Seed Problem' }).locator('.logged-badge')).toHaveText('Done');
  // The profile's logbook lists it, linking back to the problem.
  const profile = await openProfile(climber.current.context, climber.current.account.id, climber.current.account.name);
  await expect(profile.getByRole('heading', { name: /^Logged climbs/ })).toContainText('1');
  const entry = profile.getByRole('link', { name: entryName, exact: true });
  await expect(entry).toHaveAttribute('href', '#' + new URLSearchParams({ location: location.id, boulder: boulder.id, problem: problem.id }));
  await expect(profile.locator('.problem-row').filter({ hasText: entryName })).toContainText(`${location.name} · Seed Boulder`);
  // Unlog from the problem page.
  await page.goBack();
  await unlog.click();
  await expect(page.getByRole('button', { name: '+ Log problem', exact: true })).toBeVisible();
  // API/DB check: the logbook is empty again.
  expect(await (await climber.current.request.get('/api/logbook')).json(), 'API/DB: logbook empty').toEqual([]);
});

test('climbs can be removed from your own logbook, but not from someone else\'s', async () => {
  const { problem } = await seedLocation(climber.current.request, prefix, { media: false });
  await logProblem(climber.current.request, problem.id);
  // Someone else sees the climb on the climber's public profile, without a Remove button.
  const others = await openProfile(viewer.current.context, climber.current.account.id, climber.current.account.name);
  await expect(others.getByRole('link', { name: entryName, exact: true })).toBeVisible();
  await expect(others.getByRole('button', { name: /from logged climbs$/ })).toHaveCount(0);
  // The climber can remove it from their own profile.
  const own = await openProfile(climber.current.context, climber.current.account.id, climber.current.account.name);
  await own.getByRole('button', { name: 'Remove Seed Problem from logged climbs', exact: true }).click();
  await expect(own.getByText('No climbs logged yet.', { exact: true })).toBeVisible();
  expect(await (await climber.current.request.get('/api/logbook')).json(), 'API/DB: logbook empty').toEqual([]);
});

test('a logged problem that is later deleted stays in the logbook, marked deleted', async () => {
  const { boulder, problem } = await seedLocation(climber.current.request, prefix, { media: false });
  await logProblem(climber.current.request, problem.id);
  expect((await editGuide(climber.current.request, g => { find(g, boulder.id).problems = []; })).status(), 'Problem deleted').toBe(200);
  const profile = await openProfile(climber.current.context, climber.current.account.id, climber.current.account.name);
  await expect(profile.getByText(entryName + ' (deleted)', { exact: true })).toBeVisible();
  await expect(profile.getByRole('link', { name: entryName })).toHaveCount(0);
});

test('a guest is asked to sign up instead of logging problems', async ({ browser }) => {
  const { location, boulder, problem } = await seedLocation(climber.current.request, prefix, { media: false });
  const guest = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const page = await openPage(guest, { location: location.id, boulder: boulder.id, problem: problem.id }, entryName);
    const log = page.getByRole('button', { name: '+ Log problem', exact: true });
    await expect(log).toHaveAttribute('aria-disabled', 'true');
    // API check: the logbook refuses signed-out requests.
    expect((await guest.request.post('/api/logbook', { data: { problemId: problem.id, completed: true } })).status(), 'Guest logging is refused').toBe(401);
  } finally { await guest.close(); }
});

// Regression: this used to show "Could not load or save your logbook. Check your connection and that the logbook SQL
// migration has been applied.", blaming the connection or setup instead of saying the problem was removed.
test('logging a problem that was deleted meanwhile gives a clear message', async () => {
  const { location, boulder, problem } = await seedLocation(climber.current.request, prefix, { media: false });
  const page = await openPage(climber.current.context, { location: location.id, boulder: boulder.id, problem: problem.id }, entryName);
  const before = await (await climber.current.request.get('/api/logbook')).json();
  // The problem is deleted after the page loaded.
  expect((await editGuide(climber.current.request, g => { find(g, boulder.id).problems = []; })).status(), 'Problem deleted').toBe(200);
  await page.getByRole('button', { name: '+ Log problem', exact: true }).click();
  const alert = page.locator('.problem-log-action').getByRole('alert');
  await expect(alert).toBeVisible();
  expect(await (await climber.current.request.get('/api/logbook')).json(), 'API/DB: nothing logged').toEqual(before);
  await expect(alert, 'Says the problem no longer exists').toHaveText('This problem no longer exists. It may have been removed; reload to see the latest guide.');
});
