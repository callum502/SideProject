import { test, expect } from '@playwright/test';

test('logs in through the form, keeps the session on reload, and logs out', async ({ page, context }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('Set E2E_EMAIL and E2E_PASSWORD in .env.local to a confirmed local account with a completed profile.');
  }

  await page.goto('/#login');
  const loginHeading = page.getByRole('heading', { name: 'Welcome back', exact: true });
  const accountMenu = page.getByRole('button', { name: /^Account menu for / });
  await expect(loginHeading).toBeVisible();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/#explore$/);
  await expect(accountMenu).toBeVisible();
  expect((await context.cookies()).some(cookie => cookie.name === 'sideproj_session')).toBe(true);

  await page.reload();
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
  await page.getByRole('button', { name: 'Log Out', exact: true }).click();
  await expect(page).toHaveURL(/#login$/);
  await expect(loginHeading).toBeVisible();
  await expect(accountMenu).toHaveCount(0);
  expect((await context.cookies()).some(cookie => cookie.name === 'sideproj_session')).toBe(false);
  const session = await context.request.get('/api/session');
  expect(session.ok()).toBe(true);
  expect((await session.json()).user).toBeNull();

  await page.reload();
  await expect(loginHeading).toBeVisible();
  await expect(accountMenu).toHaveCount(0);
});
