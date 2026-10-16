import { test, expect } from '@playwright/test';
import { login, createLocation, editItem, deleteItem, deleteLocationsWithPrefix, assertLocationExistsDB, assertLocationOldDetailsRemovedFromDB, assertLocationRemovedFromDB } from './testHelpers';

test('location CRUD', async ({ page }, info) => {
  // Keep cleanup scoped to the data created by this test.
  const prefix = 'test_location_';
  // Sign in using the configured local test account.
  await login(page);

  try {
    const { location } = await test.step('Create', async () => {
      // Create the location once; later steps reuse its ID.
      const location = await createLocation(page, prefix);
      // Verify the displayed location name, approach notes and coordinates.
      await expect(page.getByRole('heading', { name: location.name, exact: true })).toBeVisible();
      const approach = page.locator('.location-info .preserve');
      await expect(approach).toBeVisible();
      await expect(approach).toHaveText('Follow the test path from the parking area.');
      await expect(page.locator('.coordinates')).toBeVisible();
      await expect(page.locator('.coordinates')).toHaveText('56.80000, -3.20000');
      // API/DB check: verify the created record and its saved details independently of the UI.
      await assertLocationExistsDB(page, location.id, { name: location.name, latitude: '56.8', longitude: '-3.2', approach: 'Follow the test path from the parking area.' });
      return { location };
    });

    await test.step('Edit', async () => {
      // Keep the original values for every field this edit will change.
      const oldFields = {
        name: location.name,
        approach: location.approach,
        latitude: location.latitude,
        longitude: location.longitude,
      };
      // Set the replacement values for this item.
      const fields = { name: location.name + '_edited', approach: 'Updated approach via the bridge.', latitude: '56.81', longitude: '-3.21' };
      // Save through the edit form and check the heading after reloading.
      await editItem(page, 'location', fields);
      // Verify the displayed location name, approach notes and coordinates.
      await expect(page.getByRole('heading', { name: fields.name, exact: true })).toBeVisible();
      const approach = page.locator('.location-info .preserve');
      await expect(approach).toBeVisible();
      await expect(approach).toHaveText(fields.approach);
      await expect(page.locator('.coordinates')).toBeVisible();
      await expect(page.locator('.coordinates')).toHaveText('56.81000, -3.21000');
      // API/DB check: verify all edited fields were persisted.
      await assertLocationExistsDB(page, location.id, fields);
      // API/DB check: none of the edited fields should retain their previous values.
      await assertLocationOldDetailsRemovedFromDB(page, location.id, oldFields);
    });

    await test.step('Delete', async () => {
      // Remove the same item through the confirmation dialog.
      await deleteItem(page, 'location');
      // Reload Explore and search for the deleted location by its unique name.
      await page.reload();
      await expect(page.getByRole('button', { name: /Create location/ })).toBeEnabled();
      await page.getByRole('searchbox', { name: 'Find a location' }).fill(location.name);
      // Verify search finished with no matching location, rather than a loading state.
      await expect(page.getByRole('region', { name: 'Find a climbing location' }).getByRole('status')).toHaveText(/^(No matching locations\.|No locations yet\. Create a location to get started\.)$/);
      await expect(page.locator('.location-result')).toHaveCount(0);
      // API/DB check: verify the deleted ID is absent from persisted data.
      await assertLocationRemovedFromDB(page, location.id);
    });
  } finally {
    // Remove leftover test data even if a step fails; cleanup errors are only warnings.
    await deleteLocationsWithPrefix(page, prefix, info);
  }
});
