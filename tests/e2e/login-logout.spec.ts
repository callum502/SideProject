import { test, expect } from '@playwright/test';

test('logs in through the form, keeps the session on reload, and logs out', async ({ page, context }) => {
  // Read the configured local account credentials.
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('Set E2E_EMAIL and E2E_PASSWORD in .env.local to a confirmed local account with a completed profile.');
  }

  // Open the login page and locate its heading and account menu.
  await page.goto('/#login');
  const loginHeading = page.getByRole('heading', { name: 'Welcome back', exact: true });
  const accountMenu = page.getByRole('button', { name: /^Account menu for / });
  // Verify the login page is visible.
  await expect(loginHeading).toBeVisible();
  // Enter the credentials and submit the login form.
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  // Verify login navigates to the locations page.
  await expect(page).toHaveURL(/#explore$/);
  // Verify signed-in controls are visible.
  await expect(accountMenu).toBeVisible();
  // Verify login created the session cookie.
  expect((await context.cookies()).some(cookie => cookie.name === 'sideproj_session')).toBe(true);

  // Reload to verify authentication state persists.
  await page.reload();
  // Verify signed-in controls are visible.
  await expect(accountMenu).toBeVisible();
  // Open the account menu and log out.
  await accountMenu.click();
  await page.getByRole('button', { name: 'Log Out', exact: true }).click();
  // Verify logout returns to the login page.
  await expect(page).toHaveURL(/#login$/);
  // Verify the login page is visible.
  await expect(loginHeading).toBeVisible();
  // Verify signed-in controls are absent.
  await expect(accountMenu).toHaveCount(0);
  // Verify logout removed the session cookie.
  expect((await context.cookies()).some(cookie => cookie.name === 'sideproj_session')).toBe(false);
  // Check the server also considers this session anonymous.
  const session = await context.request.get('/api/session');
  // Verify the session endpoint responded successfully.
  expect(session.ok()).toBe(true);
  // Verify the server returns no authenticated user.
  expect((await session.json()).user).toBeNull();

  // Reload to verify authentication state persists.
  await page.reload();
  // Verify the login page is visible.
  await expect(loginHeading).toBeVisible();
  // Verify signed-in controls are absent.
  await expect(accountMenu).toHaveCount(0);
});
