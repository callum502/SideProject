import { test, expect } from '@playwright/test';
import { login, createLocation, createBoulder, editItem, deleteItem, guide, deleteLocationsWithPrefix } from './testHelpers';

test('boulder CRUD', async ({ page }, info) => {
  // Keep cleanup scoped to the data created by this test.
  const prefix = 'test_boulder_';
  // Sign in using the configured local test account.
  await login(page);

  try {
    const { location, boulder } = await test.step('Create', async () => {
      // Create the location once; later steps reuse its ID.
      const location = await createLocation(page, prefix);
      // Create the boulder once; later steps reuse its ID.
      const boulder = await createBoulder(page, location);
      return { location, boulder };
    });

    await test.step('Edit', async () => {
      // Set the replacement values for this item.
      const fields = { name: 'Edited Boulder', notes: 'Updated directions past the stream.', otherNotes: 'Bring two mats.' };
      // Save through the edit form and check the heading after reloading.
      await editItem(page, 'boulder', fields);
      // Read persisted data from the API, independently of the displayed page.
      const savedGuide = await guide(page);
      const savedLocation = savedGuide.locations.find((item: any) => item.id === location.id);
      // The parent location must still exist after editing or deleting its child.
      expect(savedLocation, "Parent location still exists").toBeDefined();
      const savedBoulder = savedLocation.boulders.find((item: any) => item.id === boulder.id);
      // Every edited field should match the values submitted above.
      expect(savedBoulder, 'boulder changes were saved').toMatchObject(fields);
    });

    await test.step('Delete', async () => {
      // Remove the same item through the confirmation dialog.
      await deleteItem(page, 'boulder');
      // Read persisted data from the API, independently of the displayed page.
      const savedGuide = await guide(page);
      const savedLocation = savedGuide.locations.find((item: any) => item.id === location.id);
      // The parent location must still exist after editing or deleting its child.
      expect(savedLocation, "Parent location still exists").toBeDefined();
      const savedBoulder = savedLocation.boulders.find((item: any) => item.id === boulder.id);
      // No item with this ID should remain after deletion.
      expect(savedBoulder, 'boulder was deleted').toBeUndefined();
    });
  } finally {
    // Remove leftover test data even if a step fails; cleanup errors are only warnings.
    await deleteLocationsWithPrefix(page, prefix, info);
  }
});
