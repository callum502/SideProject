import { test, expect } from './fixtures';
import { testUser, openPage, seedLocation } from './seedHelpers';

const prefix = 'test_nav_loc_';
const user = testUser('test_nav_user_', prefix);

test('the breadcrumb trail leads back from a problem to its boulder, location and Explore', async () => {
  const { location, boulder, problem } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(
    user.current.context,
    { location: location.id, boulder: boulder.id, problem: problem.id },
    'V2 (5+) - Seed Problem'
  );
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  // The trail names every level, with the current page last and not a link.
  await expect(trail.getByRole('listitem')).toHaveText([
    /Explore\s*Find locations/,
    new RegExp('Location\\s*' + location.name),
    /Boulder\s*Seed Boulder/,
    /Problem\s*Seed Problem/,
  ]);
  await expect(trail.locator('[aria-current="page"]')).toContainText('Seed Problem');
  // Each crumb opens its page.
  await trail.getByRole('link', { name: /Seed Boulder/ }).click();
  await expect(
    page.locator('.detail-banner').getByRole('heading', { name: 'Seed Boulder', exact: true })
  ).toBeVisible();
  await trail.getByRole('link', { name: new RegExp(location.name) }).click();
  await expect(page.locator('.detail-banner').getByRole('heading', { name: location.name, exact: true })).toBeVisible();
  await trail.getByRole('link', { name: /Find locations/ }).click();
  await expect(page).toHaveURL(/#explore$/);
});

test('a deep link opens the page directly, as when shared', async ({ browser }) => {
  const { location, boulder, problem } = await seedLocation(user.current.request, prefix, { media: false });
  // A signed-out visitor following a shared link lands on the problem.
  const guest = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await openPage(
      guest,
      { location: location.id, boulder: boulder.id, problem: problem.id },
      'V2 (5+) - Seed Problem'
    );
  } finally {
    await guest.close();
  }
});

test('links to records that do not exist say so', async () => {
  const { location, boulder } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await user.current.context.newPage();
  // An unknown location.
  await page.goto('/#' + new URLSearchParams({ location: crypto.randomUUID() }));
  await expect(page.getByRole('heading', { name: 'Location not found', exact: true })).toBeVisible();
  await expect(
    page.getByText('This location may have been removed. Return to search to find another location.', { exact: true })
  ).toBeVisible();
  // An unknown problem on a real boulder.
  await page.goto(
    '/#' + new URLSearchParams({ location: location.id, boulder: boulder.id, problem: crypto.randomUUID() })
  );
  await expect(page.getByRole('heading', { name: 'Problem not found', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]')).toContainText(
    'Problem not found'
  );
});
