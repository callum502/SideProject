import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { guide, findRecord as find } from './apiTestHelpers';
import { testUser, openPage, seedLocation, editGuide } from './seedHelpers';

// The seeded problem's photo already has one green start-hold box at (100,100)–(300,300).
// Annotations are stored on a 0–1000 grid over the photo, whatever its displayed size.
const prefix = 'test_annotations_loc_';
const user = testUser('test_annotations_user_', prefix);

/**
 * Seed a location and open the annotation editor for the problem's photo.
 * @param problemId - Problem to open; defaults to the seeded problem.
 * @returns The seeded records, page, dialog, drawing canvas and the canvas's drawn shapes.
 */
async function openEditor(
  seed?: Awaited<ReturnType<typeof seedLocation>>,
  problemId?: string,
  heading = 'V2 (5+) - Seed Problem'
) {
  seed ||= await seedLocation(user.current.request, prefix);
  const page = await openPage(
    user.current.context,
    { location: seed.location.id, boulder: seed.boulder.id, problem: problemId || seed.problem.id },
    heading
  );
  await page
    .locator('.problem-photo')
    .filter({ hasText: 'Seed photo' })
    .getByRole('button', { name: 'Annotate', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Annotate photo', exact: true })).toBeVisible();
  const canvas = dialog.getByLabel('Photo annotation canvas');
  await expect(canvas).toBeVisible();
  return { ...seed, page, dialog, canvas, shapes: canvas.locator('g[opacity="0.5"] > g') };
}

/**
 * Drag across the canvas between points given as fractions of its size.
 * @param via - Extra points to pass through, for freehand strokes.
 */
async function drag(
  page: Page,
  canvas: Locator,
  from: [number, number],
  to: [number, number],
  via: [number, number][] = []
) {
  const box = (await canvas.boundingBox())!;
  const at = ([x, y]: [number, number]) => [box.x + x * box.width, box.y + y * box.height] as const;
  await page.mouse.move(...at(from));
  await page.mouse.down();
  for (const point of [...via, to]) await page.mouse.move(...at(point), { steps: 5 });
  await page.mouse.up();
}

/** Click the canvas at a point given as fractions of its size. */
async function clickCanvas(page: Page, canvas: Locator, [x, y]: [number, number]) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
}

/** Save the editor and verify the guide saved and the editor closed. */
async function save(page: Page, dialog: Locator) {
  const saved = page.waitForResponse(r => r.url().endsWith('/api/guide') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Save annotations', exact: true }).click();
  expect((await saved).status(), 'Annotations saved').toBe(200);
  await expect(dialog).toHaveCount(0);
}

test('draws each kind of shape and saves them on the problem photo', async () => {
  const { page, dialog, canvas, shapes, problem, image } = await openEditor();
  await expect(shapes).toHaveCount(1);
  // Draw one of each tool's shapes.
  const tool = (name: string) => dialog.getByRole('button', { name, exact: true }).click();
  await tool('□ Other holds · red');
  await drag(page, canvas, [0.5, 0.1], [0.7, 0.3]);
  await tool('↗ Arrow');
  await drag(page, canvas, [0.1, 0.5], [0.3, 0.6]);
  await tool('╱ Line');
  await drag(page, canvas, [0.1, 0.8], [0.4, 0.9]);
  await tool('〰 Freehand');
  await drag(
    page,
    canvas,
    [0.6, 0.6],
    [0.9, 0.6],
    [
      [0.7, 0.7],
      [0.8, 0.65],
    ]
  );
  await expect(shapes).toHaveCount(5);
  await save(page, dialog);
  // The problem's photo shows every shape.
  await expect(page.locator('.problem-photo .photo-thumb g[opacity="0.5"] > g')).toHaveCount(5);
  // API/DB check: each shape was saved with its type, colour and position on the 0–1000 grid.
  const marks = find(await guide(page), problem.id).photoAnnotations[image.id];
  expect(
    marks.map((m: any) => m.type + ':' + m.color),
    'API/DB: types and colours'
  ).toEqual(['box:green', 'box:red', 'arrow:red', 'line:red', 'freehand:red']);
  const red = marks[1];
  for (const [value, expected] of [
    [red.x, 500],
    [red.y, 100],
    [red.x2, 700],
    [red.y2, 300],
  ])
    expect(Math.abs(value - expected), 'API/DB: red box position').toBeLessThan(20);
  expect(marks[4].points.length, 'API/DB: freehand path keeps its points').toBeGreaterThan(5);
  // A reload shows the same shapes.
  await page.reload();
  await expect(page.locator('.problem-photo .photo-thumb g[opacity="0.5"] > g')).toHaveCount(5);
});

test('erase, undo and clear change the drawing, and cancelling saves nothing', async () => {
  const { page, dialog, canvas, shapes, problem, image } = await openEditor();
  const undo = dialog.getByRole('button', { name: '↶ Undo', exact: true });
  await expect(undo).toBeDisabled();
  // A click without dragging draws nothing.
  await clickCanvas(page, canvas, [0.5, 0.5]);
  await expect(shapes).toHaveCount(1);
  // Draw a line, erase it by clicking it, then undo the erase.
  await dialog.getByRole('button', { name: '╱ Line', exact: true }).click();
  await drag(page, canvas, [0.1, 0.5], [0.9, 0.5]);
  await expect(shapes).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Erase', exact: true }).click();
  await clickCanvas(page, canvas, [0.5, 0.5]);
  await expect(shapes).toHaveCount(1);
  await undo.click();
  await expect(shapes).toHaveCount(2);
  // Clear removes everything; undo brings it back.
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(shapes).toHaveCount(0);
  await undo.click();
  await expect(shapes).toHaveCount(2);
  // Cancel asks before discarding the unsaved drawing, then closes without saving.
  let saves = 0,
    asked = '';
  page.on('request', request => {
    if (request.url().endsWith('/api/guide') && request.method() === 'PUT') saves++;
  });
  page.once('dialog', confirm => {
    asked = confirm.message();
    confirm.accept();
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(asked, 'Asked before discarding').toBe('Discard your unsaved annotations?');
  expect(saves, 'No guide save was sent').toBe(0);
  expect(find(await guide(page), problem.id).photoAnnotations[image.id], 'API/DB: annotations unchanged').toHaveLength(
    1
  );
});

test('each problem keeps its own annotations on a shared photo', async () => {
  const seed = await seedLocation(user.current.request, prefix);
  // A second problem uses the same photo, without annotations.
  const second = {
    id: crypto.randomUUID(),
    name: 'Second line',
    grade: 'V4 (6B/6B+)',
    description: 'Shares the photo.',
    imageIds: [seed.image.id],
    videoIds: [],
  };
  expect(
    (await editGuide(user.current.request, g => find(g, seed.boulder.id).problems.push(second))).status(),
    'Second problem added'
  ).toBe(200);
  const { page, dialog, canvas, shapes } = await openEditor(seed, second.id, 'V4 (6B/6B+) - Second line');
  // The first problem's box does not appear on the second problem.
  await expect(shapes).toHaveCount(0);
  await dialog.getByRole('button', { name: '╱ Line', exact: true }).click();
  await drag(page, canvas, [0.2, 0.2], [0.8, 0.8]);
  await save(page, dialog);
  // API/DB check: each problem has only its own annotations.
  const current = await guide(page);
  expect(
    find(current, second.id).photoAnnotations[seed.image.id].map((m: any) => m.type),
    'API/DB: second problem'
  ).toEqual(['line']);
  expect(
    find(current, seed.problem.id).photoAnnotations[seed.image.id].map((m: any) => m.type),
    'API/DB: first problem unchanged'
  ).toEqual(['box']);
});

test('closing the editor with unsaved changes asks first; with none, it just closes', async () => {
  const { page, dialog, canvas, shapes, problem, image } = await openEditor();
  // Record each "Discard your unsaved annotations?" prompt, answering with `discard`.
  const asked: string[] = [];
  let discard = false;
  page.on('dialog', confirm => {
    asked.push(confirm.message());
    discard ? confirm.accept() : confirm.dismiss();
  });
  const reopen = () =>
    page
      .locator('.problem-photo')
      .filter({ hasText: 'Seed photo' })
      .getByRole('button', { name: 'Annotate', exact: true })
      .click();
  const drawLine = async () => {
    await dialog.getByRole('button', { name: '╱ Line', exact: true }).click();
    await drag(page, canvas, [0.1, 0.5], [0.9, 0.5]);
    await expect(shapes).toHaveCount(2);
  };

  await test.step('no changes: Escape closes without asking', async () => {
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(asked, 'Not asked').toEqual([]);
  });

  await test.step('unsaved drawing: Escape and ✕ ask, and keeping it leaves the drawing', async () => {
    await reopen();
    await drawLine();
    await page.keyboard.press('Escape');
    await expect.poll(() => asked.length, { message: 'Escape asked' }).toBe(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => asked.length, { message: '✕ asked' }).toBe(2);
    expect(asked, 'The warning').toEqual(Array(2).fill('Discard your unsaved annotations?'));
    await expect(dialog, 'Still open').toBeVisible();
    await expect(shapes, 'Drawing kept').toHaveCount(2);
  });

  await test.step('undoing back to the saved drawing: closes without asking', async () => {
    await dialog.getByRole('button', { name: '↶ Undo', exact: true }).click();
    await expect(shapes).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(asked.length, 'Not asked again').toBe(2);
  });

  await test.step('choosing to discard: closes and saves nothing', async () => {
    await reopen();
    await drawLine();
    discard = true;
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(asked.length, 'Asked once more').toBe(3);
    expect(
      find(await guide(page), problem.id).photoAnnotations[image.id],
      'API/DB: annotations unchanged'
    ).toHaveLength(1);
  });

  await test.step('saving: closes without asking', async () => {
    discard = false;
    await reopen();
    await drawLine();
    await save(page, dialog);
    expect(asked.length, 'Not asked when saving').toBe(3);
    expect(find(await guide(page), problem.id).photoAnnotations[image.id], 'API/DB: new line saved').toHaveLength(2);
  });
});

test('the editor stays open while saving, then closes', async () => {
  const { page, dialog, canvas, shapes, problem, image } = await openEditor();
  await dialog.getByRole('button', { name: '╱ Line', exact: true }).click();
  await drag(page, canvas, [0.1, 0.5], [0.9, 0.5]);
  await expect(shapes).toHaveCount(2);
  // Hold the save so the editor stays busy.
  let release = () => {};
  const held = new Promise<void>(resolve => (release = resolve));
  await page.route('**/api/guide', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await held;
    await route.continue();
  });
  let asked = 0;
  page.on('dialog', confirm => {
    asked++;
    confirm.dismiss();
  });
  await dialog.getByRole('button', { name: 'Save annotations', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  try {
    // Escape, ✕ and Cancel all leave it open, without asking about unsaved changes.
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(dialog, 'Still open while saving').toBeVisible();
    expect(asked, 'No discard warning while saving').toBe(0);
  } finally {
    release();
  }
  await expect(dialog).toHaveCount(0);
  expect(find(await guide(page), problem.id).photoAnnotations[image.id], 'API/DB: saved').toHaveLength(2);
});
