import { test, expect } from '@playwright/test';
import { login, createLocation, createBoulder, editItem, deleteItem } from './testHelpers';
import { deleteLocationsWithPrefix, assertBoulderExistsDB, assertBoulderOldDetailsRemovedFromDB, assertBoulderRemovedFromDB } from './apiTestHelpers';

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
      // Verify the displayed boulder name and both sets of notes.
      await expect(page.getByRole('heading', { name: 'Test Boulder', exact: true })).toBeVisible();
      const findingNotes = page.locator('.notes-block').filter({
        has: page.getByRole('heading', { name: 'Finding the Boulder', exact: true }),
      }).locator('p');
      await expect(findingNotes).toBeVisible();
      await expect(findingNotes).toHaveText('Walk ten metres past the gate.');
      const otherNotes = page.locator('.notes-block').filter({
        has: page.getByRole('heading', { name: 'Other Notes', exact: true }),
      }).locator('p');
      await expect(otherNotes).toBeVisible();
      await expect(otherNotes).toHaveText('Granite with a flat landing.');
      // API/DB check: verify the created record and its saved details independently of the UI.
      await assertBoulderExistsDB(page, location.id, boulder.id, { name: 'Test Boulder', notes: 'Walk ten metres past the gate.', otherNotes: 'Granite with a flat landing.' });
      return { location, boulder };
    });

    await test.step('Edit', async () => {
      // Keep the original values for every field this edit will change.
      const oldFields = {
        name: boulder.name,
        notes: boulder.notes,
        otherNotes: boulder.otherNotes,
      };
      // Set the replacement values for this item.
      const fields = { name: 'Edited Boulder', notes: 'Updated directions past the stream.', otherNotes: 'Bring two mats.' };
      // Save through the edit form and check the heading after reloading.
      await editItem(page, 'boulder', fields);
      // Verify the displayed boulder name and both sets of notes.
      await expect(page.getByRole('heading', { name: fields.name, exact: true })).toBeVisible();
      const findingNotes = page.locator('.notes-block').filter({
        has: page.getByRole('heading', { name: 'Finding the Boulder', exact: true }),
      }).locator('p');
      await expect(findingNotes).toBeVisible();
      await expect(findingNotes).toHaveText(fields.notes);
      const otherNotes = page.locator('.notes-block').filter({
        has: page.getByRole('heading', { name: 'Other Notes', exact: true }),
      }).locator('p');
      await expect(otherNotes).toBeVisible();
      await expect(otherNotes).toHaveText(fields.otherNotes);
      // API/DB check: verify all edited fields were persisted.
      await assertBoulderExistsDB(page, location.id, boulder.id, fields);
      // API/DB check: none of the edited fields should retain their previous values.
      await assertBoulderOldDetailsRemovedFromDB(page, location.id, boulder.id, oldFields);
    });

    await test.step('Delete', async () => {
      // Remove the same item through the confirmation dialog.
      await deleteItem(page, 'boulder');
      // Reload the parent location to check deletion survives a fresh page load.
      await page.reload();
      await expect(page.getByRole('heading', { name: location.name, exact: true })).toBeVisible();
      // Verify the boulder is absent and the location shows its empty boulder list.
      await expect(page.locator('.boulder-row')).toHaveCount(0);
      await expect(page.getByText('Add the first boulder to start adding problems, photos and videos.', { exact: true })).toBeVisible();
      // API/DB check: verify the deleted ID is absent from persisted data.
      await assertBoulderRemovedFromDB(page, location.id, boulder.id);
    });
  } finally {
    // Remove leftover test data even if a step fails; cleanup errors are only warnings.
    await deleteLocationsWithPrefix(page, prefix, info);
  }
});
