import { test, expect } from '@playwright/test';
import { login, createLocation, editItem, deleteItem, guide, deleteLocationsWithPrefix } from './testHelpers';

test('location CRUD', async ({ page }, info) => {
  // Keep cleanup scoped to the data created by this test.
  const prefix = 'test_location_';
  // Sign in using the configured local test account.
  await login(page);

  try {
    const { location } = await test.step('Create', async () => {
      // Create the location once; later steps reuse its ID.
      const location = await createLocation(page, prefix);
      return { location };
    });

    await test.step('Edit', async () => {
      // Set the replacement values for this item.
      const fields = { name: location.name + '_edited', approach: 'Updated approach via the bridge.', latitude: '56.81', longitude: '-3.21' };
      // Save through the edit form and check the heading after reloading.
      await editItem(page, 'location', fields);
      // Read persisted data from the API, independently of the displayed page.
      const savedGuide = await guide(page);
      const savedLocation = savedGuide.locations.find((item: any) => item.id === location.id);
      // Every edited field should match the values submitted above.
      expect(savedLocation, 'location changes were saved').toMatchObject(fields);
    });

    await test.step('Delete', async () => {
      // Remove the same item through the confirmation dialog.
      await deleteItem(page, 'location');
      // Read persisted data from the API, independently of the displayed page.
      const savedGuide = await guide(page);
      const savedLocation = savedGuide.locations.find((item: any) => item.id === location.id);
      // No item with this ID should remain after deletion.
      expect(savedLocation, 'location was deleted').toBeUndefined();
    });
  } finally {
    // Remove leftover test data even if a step fails; cleanup errors are only warnings.
    await deleteLocationsWithPrefix(page, prefix, info);
  }
});
