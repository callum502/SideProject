import { test, expect } from './fixtures';
import { createLocation, createBoulder, createProblem, editItem, deleteItem, cancelEditAndRemoval } from './testHelpers';
import { testUser, openPage, seedLocation } from './seedHelpers';
import { guide, findRecord as find, deleteLocationsWithPrefix, assertProblemExistsDB, assertProblemOldDetailsRemovedFromDB, assertProblemRemovedFromDB } from './apiTestHelpers';

// Each spec uses its own account (signed in through the API); the login form is covered by login-logout and auth.
const prefix = 'test_problem_';
const user = testUser('test_crud_problem_user_', prefix);

test('problem CRUD', async ({}, info) => {
  const page = await user.current.context.newPage();

  try {
    const { location, boulder, problem } = await test.step('Create', async () => {
      // Create the location once; later steps reuse its ID.
      const location = await createLocation(page, prefix);
      // Create the boulder once; later steps reuse its ID.
      const boulder = await createBoulder(page, location);
      // Create the problem once; later steps reuse its ID.
      const problem = await createProblem(page, location, boulder);
      // Verify the created problem page displays the expected grade and name.
      const problemPage = page.locator('.problem-page');
      await expect(problemPage.getByRole('heading', {
        name: 'V1 (5) - Test Problem', exact: true,
      })).toBeVisible();
      // Verify the description is visible and matches the text entered during creation.
      const description = problemPage.locator('.notes-block').filter({
        has: page.getByRole('heading', { name: 'Description', exact: true }),
      }).locator('p');
      await expect(description).toBeVisible();
      await expect(description).toHaveText('Start on the low holds and climb straight up.');
      // API/DB check: verify the created record and its saved details independently of the UI.
      await assertProblemExistsDB(page, location.id, boulder.id, problem.id, { name: 'Test Problem', grade: 'V1 (5)', description: 'Start on the low holds and climb straight up.' });
      return { location, boulder, problem };
    });

    await test.step('Edit', async () => {
      // Keep the original values for every field this edit will change.
      const oldFields = {
        name: problem.name,
        grade: problem.grade,
        description: problem.description,
      };
      // Set the replacement values for this item.
      const fields = { name: 'Edited Problem', grade: 'V3 (6A/6A+)', description: 'Updated line finishing on the right.' };
      // Save through the edit form and check the heading after reloading.
      await editItem(page, 'problem', fields);
      // Verify the edited grade, name and description on the problem page.
      await expect(page.getByRole('heading', {
        name: fields.grade + ' - ' + fields.name, exact: true,
      })).toBeVisible();
      const description = page.locator('.problem-page .notes-block').filter({
        has: page.getByRole('heading', { name: 'Description', exact: true }),
      }).locator('p');
      await expect(description).toBeVisible();
      await expect(description).toHaveText(fields.description);
      // API/DB check: verify all edited fields were persisted.
      await assertProblemExistsDB(page, location.id, boulder.id, problem.id, fields);
      // API/DB check: none of the edited fields should retain their previous values.
      await assertProblemOldDetailsRemovedFromDB(page, location.id, boulder.id, problem.id, oldFields);
    });

    await test.step('Delete', async () => {
      // Remove the same item through the confirmation dialog.
      await deleteItem(page, 'problem');
      // Reload the parent boulder to check deletion survives a fresh page load.
      await page.reload();
      await expect(page.getByRole('heading', { name: boulder.name, exact: true })).toBeVisible();
      // Verify the problem is absent and the boulder shows its empty problem list.
      await expect(page.locator('.problem-row')).toHaveCount(0);
      await expect(page.getByText('No problems yet. Add the first line on this boulder.', { exact: true })).toBeVisible();
      // API/DB check: verify the deleted ID is absent from persisted data.
      await assertProblemRemovedFromDB(page, location.id, boulder.id, problem.id);
    });
  } finally {
    // Remove leftover test data even if a step fails; cleanup errors are only warnings.
    await deleteLocationsWithPrefix(page, prefix, info);
  }
});

test('cancelling an edit or removal changes nothing', async () => {
  const { location, boulder, problem } = await seedLocation(user.current.request, prefix, { media: false });
  const page = await openPage(user.current.context, { location: location.id, boulder: boulder.id, problem: problem.id }, 'V2 (5+) - Seed Problem');
  await cancelEditAndRemoval(page, 'problem', 'V2 (5+) - Seed Problem');
  // API/DB check: the problem is unchanged.
  expect(find(await guide(page), problem.id), 'API/DB: unchanged').toMatchObject({ name: 'Seed Problem' });
});
