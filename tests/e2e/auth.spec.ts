import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { login, accountDetails } from './testHelpers';
import { emailCode, sessionUser, deleteAccountsWithPrefix, adminRequest, findRecord } from './apiTestHelpers';
import { createApiAccount, signIn, seedLocation, openPage, editGuide } from './seedHelpers';

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

/** Fill the sign-up form's profile fields; height 5 ft 10 in. */
async function fillSignupProfile(page: Page, name: string) {
  await page.locator('input[name="name"]').fill(name);
  await page.locator('select[name="heightFeet"]').selectOption('5');
  await page.locator('select[name="heightInches"]').selectOption('10');
}

/** Accounts with this email, from the local Supabase admin API. */
async function accountsWithEmail(email: string) {
  const { users } = await (await adminRequest('/auth/v1/admin/users?page=1&per_page=1000')).json();
  return users.filter((u: { email?: string }) => u.email === email.toLowerCase());
}

/** Emails Mailpit has received for the address since the given time, after giving any email time to arrive. */
async function emailsSince(page: Page, email: string, after: Date) {
  await page.waitForTimeout(3000);
  const search = await (await fetch('http://127.0.0.1:54324/api/v1/search?query=' + encodeURIComponent('to:"' + email + '"'))).json();
  return (search.messages || []).filter((m: { Created: string }) => new Date(m.Created) >= new Date(after.getTime() - 1000)).length;
}

test("login gives the same answer for an unknown email as a wrong password, and ignores the email's case", async ({ page }) => {
  const account = await createApiAccount(prefix);
  await loginPage(page);
  // An unknown email doesn't reveal that no account exists.
  await submitCredentials(page, prefix + 'nobody_' + crypto.randomUUID().slice(0, 8) + '@example.com', 'pw-anything', 'Log in');
  await expect(page.getByRole('alert')).toHaveText('Invalid login credentials');
  // The email works in any case, with surrounding spaces.
  await login(page, { email: '  ' + account.email.toUpperCase() + ' ', password: account.password });
});

// Fails until fixed: signing up with a registered email shows Supabase's "User already registered", which tells
// anyone whether an email has an account (auth.mjs signup passes the message through). The app's own reply,
// "...If you already have an account, log in instead.", is written to avoid revealing that.
test('sign-up with an already registered email looks like any sign-up, and creates and sends nothing', async ({ page }) => {
  const existing = await createApiAccount(prefix);
  const details = accountDetails(prefix);
  await loginPage(page, 'Sign up');
  await fillSignupProfile(page, details.name);
  const sent = new Date();
  await submitCredentials(page, existing.email, details.password, 'Send verification code');
  // The reply is the same as for a new email, so it doesn't reveal the account exists.
  await expect(page.getByRole('heading', { name: 'Check your inbox', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Check your email for a confirmation code. If you already have an account, log in instead.');
  expect(await accountsWithEmail(existing.email), 'No second account').toHaveLength(1);
  expect(await emailsSince(page, existing.email, sent), 'No email sent').toBe(0);
  // The existing account still logs in with its own password.
  await page.reload();
  await login(page, existing);
});

test('sign-up refuses a display name of only spaces and an invalid email', async ({ page }) => {
  const details = accountDetails(prefix);
  await loginPage(page, 'Sign up');
  await fillSignupProfile(page, details.name);
  // The browser refuses an email without an @.
  await submitCredentials(page, 'not-an-email', details.password, 'Send verification code');
  expect(await page.locator('input[name="email"]').evaluate((input: HTMLInputElement) => input.validity.typeMismatch), 'Invalid email refused').toBe(true);
  // A display name of only spaces passes the browser but not the server.
  await page.locator('input[name="name"]').fill('   ');
  await submitCredentials(page, details.email, details.password, 'Send verification code');
  await expect(page.getByRole('alert')).toContainText('Enter a display name');
  expect(await accountsWithEmail(details.email), 'No account created').toHaveLength(0);
});

test("a wrong confirmation code is refused, and a used code can't be used again", async ({ page }) => {
  const details = accountDetails(prefix);
  await loginPage(page, 'Sign up');
  await fillSignupProfile(page, details.name);
  const sent = new Date();
  await submitCredentials(page, details.email, details.password, 'Send verification code');
  await expect(page.getByRole('heading', { name: 'Check your inbox', exact: true })).toBeVisible();
  const verify = async (code: string) => {
    await page.locator('input[name="code"]').fill(code);
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  };
  // A wrong code is refused, and the account stays unconfirmed.
  await verify('000000');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check your inbox', exact: true })).toBeVisible();
  expect((await accountsWithEmail(details.email))[0]?.email_confirmed_at, 'Still unconfirmed').toBeFalsy();
  // The emailed code confirms it.
  const code = await emailCode(details.email, sent);
  await verify(code);
  await expect(page.getByRole('status')).toHaveText('Email confirmed. You can now log in.');
  // Using the same code again is refused.
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.getByRole('button', { name: 'Verify your email', exact: true }).click();
  await page.locator('input[name="email"]').fill(details.email);
  await verify(code);
  await expect(page.getByRole('alert')).toBeVisible();
});

test('a recovery code works only once, and an unknown email gets the same reply without an email', async ({ page }) => {
  // An unknown email: the same reply, and nothing is sent.
  const unknown = prefix + 'nobody_' + crypto.randomUUID().slice(0, 8) + '@example.com';
  await loginPage(page, 'Forgot password?');
  const asked = new Date();
  await page.locator('input[name="email"]').fill(unknown);
  await page.getByRole('button', { name: 'Send recovery code', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('If an account exists, a recovery code has been emailed to you.');
  expect(await emailsSince(page, unknown, asked), 'No email sent').toBe(0);
  // A real account resets its password with the emailed code.
  const account = await createApiAccount(prefix);
  const newPassword = 'pw-new-' + crypto.randomUUID();
  /** Request a recovery code, then submit the given code (or the emailed one) with the new password. */
  async function reset(code?: string) {
    await page.reload();
    await loginPage(page, 'Forgot password?');
    const sent = new Date();
    await page.locator('input[name="email"]').fill(account.email);
    await page.getByRole('button', { name: 'Send recovery code', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
    const emailed = await emailCode(account.email, sent);
    await page.locator('input[name="code"]').fill(code || emailed);
    await page.locator('input[name="password"]').fill(newPassword);
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    return emailed;
  }
  const used = await reset();
  await expect(page.getByRole('status')).toHaveText('Password updated. Log in with your new password.');
  // The used code is refused next time.
  await reset(used);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
});

test('deleting an account needs DELETE typed exactly, and can be cancelled', async ({ browser }) => {
  const account = await createApiAccount(prefix);
  const user = await signIn(browser, account);
  try {
    const page = await user.context.newPage();
    await page.goto('/#user=' + account.id);
    await page.getByRole('button', { name: 'Delete account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    // Anything but DELETE, including lower case, is blocked by the browser, so no request is sent...
    let deletes = 0;
    page.on('request', request => { if (request.url().endsWith('/api/account') && request.method() === 'DELETE') deletes++; });
    const confirmation = dialog.getByLabel('Type DELETE to confirm');
    await confirmation.fill('delete');
    await dialog.getByRole('button', { name: 'Permanently delete account', exact: true }).click();
    expect(await confirmation.evaluate((input: HTMLInputElement) => input.validity.patternMismatch), 'Lower case refused').toBe(true);
    expect(deletes, 'No deletion request sent').toBe(0);
    // ...and the server refuses it from any client.
    const response = await user.request.delete('/api/account', { headers: { Origin: test.info().project.use.baseURL! }, data: { confirmation: 'delete' } });
    expect({ status: response.status(), error: (await response.json()).error }, 'API: lower case refused').toEqual({ status: 400, error: 'Type DELETE to confirm.' });
    // Cancelling keeps the account.
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Account menu for ' + account.name, exact: true })).toBeVisible();
    expect(await accountsWithEmail(account.email), 'Account kept').toHaveLength(1);
  } finally { await user.context.close(); }
});

test('saving after the session ended elsewhere asks you to log in again', async ({ browser }) => {
  const account = await createApiAccount(prefix);
  const user = await signIn(browser, account);
  try {
    const { location } = await seedLocation(user.request, 'test_auth_loc_', { media: false });
    const page = await openPage(user.context, { location: location.id }, location.name);
    await page.getByRole('button', { name: /^Edit location/ }).click();
    await page.getByRole('dialog').getByLabel(/^Location name/).fill(location.name + '_edited');
    // The session ends in another tab.
    expect((await user.request.post('/api/logout')).status(), 'Logged out elsewhere').toBe(200);
    await page.getByRole('dialog').getByRole('button', { name: 'Save location', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Log in');
    expect(findRecord(await (await user.request.get('/api/guide')).json(), location.id).name, 'Nothing saved').toBe(location.name);
  } finally {
    // The account is signed out, so remove its location as it before deleting the account.
    const owner = await signIn(browser, account);
    await editGuide(owner.request, g => { g.locations = g.locations.filter((l: any) => !l.name.startsWith('test_auth_loc_') || l.createdBy !== account.id); });
    await owner.context.close();
    await user.context.close();
  }
});
