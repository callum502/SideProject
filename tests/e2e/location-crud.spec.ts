import { test, expect } from '@playwright/test';
import { login, createLocation, editItem, deleteItem, guide, testPrefix, deleteLocationsWithPrefix } from './testHelpers';

test('location CRUD', async ({ page }, info) => {
  test.setTimeout(180000);
  const prefix = testPrefix('location');
  await login(page);

  try {
    const { location } = await test.step('Create', async () => {
      const location = await createLocation(page, prefix);
      return { location };
    });

    await test.step('Edit', async () => {
      const fields = { name: location.name + '_edited', approach: 'Updated approach via the bridge.', latitude: '56.81', longitude: '-3.21' };
      await editItem(page, 'location', fields);
      expect((await guide(page)).locations.find((l: any) => l.id === location.id)).toMatchObject(fields);
    });

    await test.step('Delete', async () => {
      await deleteItem(page, 'location');
      expect((await guide(page)).locations.find((l: any) => l.id === location.id)).toBeUndefined();
    });
  } finally {
    await deleteLocationsWithPrefix(page, prefix, info);
  }
});
