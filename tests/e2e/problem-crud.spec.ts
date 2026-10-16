import { test, expect } from '@playwright/test';
import { login, createLocation, createBoulder, createProblem, editItem, deleteItem, guide, testPrefix, deleteLocationsWithPrefix } from './testHelpers';

test('problem CRUD', async ({ page }, info) => {
  test.setTimeout(180000);
  const prefix = testPrefix('problem');
  await login(page);

  try {
    const { location, boulder, problem } = await test.step('Create', async () => {
      const location = await createLocation(page, prefix);
      const boulder = await createBoulder(page, location);
      const problem = await createProblem(page, location, boulder);
      return { location, boulder, problem };
    });

    await test.step('Edit', async () => {
      const fields = { name: 'Edited Problem', grade: 'V3 (6A/6A+)', description: 'Updated line finishing on the right.' };
      await editItem(page, 'problem', fields);
      expect((await guide(page)).locations.find((l: any) => l.id === location.id).boulders.find((b: any) => b.id === boulder.id).problems.find((p: any) => p.id === problem.id)).toMatchObject(fields);
    });

    await test.step('Delete', async () => {
      await deleteItem(page, 'problem');
      expect((await guide(page)).locations.find((l: any) => l.id === location.id).boulders.find((b: any) => b.id === boulder.id).problems.find((p: any) => p.id === problem.id)).toBeUndefined();
    });
  } finally {
    await deleteLocationsWithPrefix(page, prefix, info);
  }
});
