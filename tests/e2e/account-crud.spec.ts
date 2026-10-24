import { test, expect } from './fixtures';
import { createAccount, openProfile, editProfile, deleteAccount } from './testHelpers';
import {
  deleteAccountsWithPrefix,
  savedProfile,
  assertAccountExistsDB,
  assertAccountOldDetailsRemovedFromDB,
  assertAccountRemovedFromDB,
} from './apiTestHelpers';

test('account CRUD', async ({ page }, info) => {
  // Keep cleanup scoped to the accounts created by this test.
  const prefix = 'test_account_';

  try {
    const { account } = await test.step('Create', async () => {
      // Sign up, confirm the email and log in as the new account.
      const account = await createAccount(page, prefix);
      // Verify the profile page shows the sign-up name, height and ape index.
      await openProfile(page, account.name);
      const measurements = page.locator('.profile-measurements');
      await expect(measurements.locator('div', { hasText: 'Height' }).locator('dd')).toHaveText('5 ft 10 In');
      await expect(measurements.locator('div', { hasText: 'Ape index' }).locator('dd')).toHaveText('+2 In');
      // Verify own-profile controls are offered to the new account.
      await expect(page.getByRole('link', { name: 'Edit profile', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible();
      // API/DB check: verify the account and its public profile hold the sign-up details.
      await assertAccountExistsDB(page, account.id, savedProfile(account));
      return { account };
    });

    await test.step('Edit', async () => {
      // Keep the original saved values for every field this edit will change.
      const oldFields = savedProfile(account);
      // Set the replacement values for this account.
      const fields = { name: account.name + '_edited', heightFeet: '6', heightInches: '1', apeIndex: '-1' };
      // Save through the profile form.
      await editProfile(page, fields);
      // Verify the account menu uses the new display name.
      await expect(page.getByRole('button', { name: 'Account menu for ' + fields.name, exact: true })).toBeVisible();
      // Reload to verify the edit survives a fresh page load, then check the profile page.
      await page.reload();
      await openProfile(page, fields.name);
      const measurements = page.locator('.profile-measurements');
      await expect(measurements.locator('div', { hasText: 'Height' }).locator('dd')).toHaveText('6 ft 1 In');
      await expect(measurements.locator('div', { hasText: 'Ape index' }).locator('dd')).toHaveText('-1 In');
      // API/DB check: verify all edited fields were persisted.
      await assertAccountExistsDB(page, account.id, savedProfile(fields));
      // API/DB check: none of the edited fields should retain their previous values.
      await assertAccountOldDetailsRemovedFromDB(page, account.id, oldFields);
    });

    await test.step('Delete', async () => {
      // Delete the account from its profile page through the confirmation dialog.
      await deleteAccount(page);
      // Verify signed-in controls are gone after reloading.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Account menu for / })).toHaveCount(0);
      // Verify the login form rejects the deleted credentials.
      await page.locator('input[name="email"]').fill(account.email);
      await page.locator('input[name="password"]').fill(account.password);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Invalid login credentials');
      await expect(page.getByRole('button', { name: /^Account menu for / })).toHaveCount(0);
      // API/DB check: verify the session ended, the profile is gone and login is refused.
      await assertAccountRemovedFromDB(page, account);
    });
  } finally {
    // Remove this run's account if a step failed before deletion, plus leftovers from earlier runs.
    await deleteAccountsWithPrefix(prefix, info);
  }
});
