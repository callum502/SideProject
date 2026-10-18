import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { login, accountDetails } from './testHelpers';
import { emailCode, sessionUser, deleteAccountsWithPrefix } from './apiTestHelpers';
import { createApiAccount, signIn } from './seedHelpers';

// Accounts here are created per test (some deliberately unconfirmed or incomplete) and removed afterwards.
const prefix = 'test_auth_user_';
test.afterAll(async ({}, info) => { await deleteAccountsWithPrefix(prefix, info); });

/** Open the login page, optionally switching to another screen by its link. */
async function loginPage(page: Page, link?: string) {
  await page.goto('/#login');
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  if (link) await page.getByRole('button', { name: link, exact: true }).click();
}

/** Fill the email and password fields and submit the current screen. */
async function submitCredentials(page: Page, email: string, password: string, action: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: action, exact: true }).click();
}

test('login explains a wrong password and an unconfirmed email', async ({ page }) => {
  const account = await createApiAccount(prefix);
  await loginPage(page);
  await submitCredentials(page, account.email, account.password + 'x', 'Log in');
  await expect(page.getByRole('alert')).toHaveText('Invalid login credentials');
  // An account that never confirmed its email is told to do so.
  // Regression: Supabase refuses this login itself, and its raw "Email not confirmed" used to be shown.
  const unconfirmed = await createApiAccount(prefix, { confirmed: false });
  await submitCredentials(page, unconfirmed.email, unconfirmed.password, 'Log in');
  await expect(page.getByRole('alert')).toHaveText('Confirm your email before logging in.');
  expect(await sessionUser(page), 'API: still signed out').toBeNull();
});

test('sign-up refuses a display name that is already taken and a short password', async ({ page }) => {
  const existing = await createApiAccount(prefix);
  const details = accountDetails(prefix);
  await loginPage(page, 'Sign up');
  await page.locator('input[name="name"]').fill(existing.name.toUpperCase());
  await page.locator('select[name="heightFeet"]').selectOption('5');
  await page.locator('select[name="heightInches"]').selectOption('10');
  // A 5-character password fails the browser's minimum length check, so nothing is sent.
  await submitCredentials(page, details.email, '12345', 'Send verification code');
  expect(await page.locator('#auth-password').evaluate((input: HTMLInputElement) => input.validity.tooShort), 'Password is too short').toBe(true);
  // With a valid password, the taken display name (in any case) is refused.
  await submitCredentials(page, details.email, details.password, 'Send verification code');
  await expect(page.getByRole('alert')).toHaveText('That display name is already taken. Choose a different name.');
  await expect(page.getByRole('heading', { name: 'Find your community', exact: true })).toBeVisible();
});

test('a forgotten password can be reset with the emailed code', async ({ page }) => {
  const account = await createApiAccount(prefix);
  const newPassword = 'pw-new-' + crypto.randomUUID();
  await loginPage(page, 'Forgot password?');
  await expect(page.getByRole('heading', { name: 'Reset your password', exact: true })).toBeVisible();
  // Request a code; the reply doesn't reveal whether the account exists.
  const sent = new Date();
  await page.locator('input[name="email"]').fill(account.email);
  await page.getByRole('button', { name: 'Send recovery code', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('If an account exists, a recovery code has been emailed to you.');
  // Enter the code from the email, which local Supabase delivers to Mailpit, and a new password.
  await expect(page.locator('input[name="email"]')).toHaveValue(account.email);
  await page.locator('input[name="code"]').fill(await emailCode(account.email, sent));
  await page.locator('input[name="password"]').fill(newPassword);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Password updated. Log in with your new password.');
  // The old password no longer works; the new one does.
  await submitCredentials(page, account.email, account.password, 'Log in');
  await expect(page.getByRole('alert')).toHaveText('Invalid login credentials');
  await login(page, { email: account.email, password: newPassword });
});

test('a wrong recovery code is refused', async ({ page }) => {
  const account = await createApiAccount(prefix);
  await loginPage(page, 'Forgot password?');
  await page.locator('input[name="email"]').fill(account.email);
  await page.getByRole('button', { name: 'Send recovery code', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
  await page.locator('input[name="code"]').fill('000000');
  await page.locator('input[name="password"]').fill('pw-never-used');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
  // The original password still works. Reload first: the login screen keeps its current step across hash changes.
  await page.reload();
  await login(page, account);
});

test('an incomplete profile must be completed before contributing', async ({ browser }) => {
  const account = await createApiAccount(prefix, { profile: false });
  const user = await signIn(browser, account);
  try {
    const page = await user.context.newPage();
    await page.goto('/#explore');
    // The app asks for the missing details instead of showing the guide.
    await expect(page.getByRole('heading', { name: 'Complete your profile', exact: true })).toBeVisible();
    // API check: saving to the guide is refused until then.
    expect((await user.request.put('/api/guide', { data: { changes: [] } })).status(), 'API: contributing refused').toBe(403);
    // Completing it opens Explore.
    await page.locator('select[name="heightFeet"]').selectOption('6');
    await page.locator('select[name="heightInches"]').selectOption('0');
    const saved = page.waitForResponse(r => r.url().endsWith('/api/profile') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    expect((await saved).status(), 'Profile saved').toBe(200);
    await expect(page).toHaveURL(/#explore$/);
    await expect(page.getByRole('button', { name: /Create location/ })).toBeVisible();
    expect((await user.request.put('/api/guide', { data: { changes: [] } })).status(), 'API: contributing allowed').toBe(200);
  } finally { await user.context.close(); }
});

test('the account menu opens, closes and links to Friends, Profile and Log Out', async ({ page }) => {
  const account = await createApiAccount(prefix);
  await login(page, account);
  const trigger = page.getByRole('button', { name: 'Account menu for ' + account.name, exact: true });
  const menu = page.locator('#user-menu-options');
  // Escape and clicking elsewhere both close it.
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await expect(menu).toHaveCount(0);
  // Its links open Friends and the user's own profile.
  await trigger.click();
  await menu.getByRole('link', { name: 'Friends', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Friends', exact: true })).toBeVisible();
  await trigger.click();
  await menu.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('#user=' + account.id + '$'));
  // Log Out ends the session.
  await trigger.click();
  await menu.getByRole('button', { name: 'Log Out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(trigger).toHaveCount(0);
  expect(await sessionUser(page), 'API: signed out').toBeNull();
});

test('a guest can continue to Explore without an account', async ({ page }) => {
  await loginPage(page);
  await page.getByRole('link', { name: /Continue as guest/ }).click();
  await expect(page).toHaveURL(/#explore$/);
  await expect(page.getByLabel('Find a location', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
});

test('Google sign-in starts from the button and reports a failed return', async ({ page }) => {
  // A real Google login can't run in tests: check the button asks the server to start it...
  await loginPage(page);
  await page.route('**/api/auth/google', route => route.fulfill({ json: { url: '/#login' } }));
  const started = page.waitForRequest(r => r.url().endsWith('/api/auth/google') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await started;
  // ...and that a failed return from Google is explained.
  await page.goto('/?google_error=1#login');
  await expect(page.getByRole('alert')).toHaveText('Google sign-in could not be completed. Please try again.');
  await expect(page).not.toHaveURL(/google_error/);
});
