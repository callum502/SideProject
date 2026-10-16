import { test, expect } from '@playwright/test';
import { login, createLocation, createBoulder, editItem, deleteItem, guide, testPrefix, deleteLocationsWithPrefix } from './testHelpers';

test('boulder CRUD', async ({ page }, info) => {
  test.setTimeout(180000);
  const prefix = testPrefix('boulder');
  await login(page);

  try {
    const { location, boulder } = await test.step('Create', async () => {
      const location = await createLocation(page, prefix);
      const boulder = await createBoulder(page, location);
      return { location, boulder };
    });

    await test.step('Edit', async () => {
      const fields = { name: 'Edited Boulder', notes: 'Updated directions past the stream.', otherNotes: 'Bring two mats.' };
      await editItem(page, 'boulder', fields);
      expect((await guide(page)).locations.find((l: any) => l.id === location.id).boulders.find((b: any) => b.id === boulder.id)).toMatchObject(fields);
    });

    await test.step('Delete', async () => {
      await deleteItem(page, 'boulder');
      expect((await guide(page)).locations.find((l: any) => l.id === location.id).boulders.find((b: any) => b.id === boulder.id)).toBeUndefined();
    });
  } finally {
    await deleteLocationsWithPrefix(page, prefix, info);
  }
});
