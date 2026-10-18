import { test as base, expect, type BrowserContext } from '@playwright/test';

// A 1×1 transparent PNG served in place of every OpenStreetMap tile.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/**
 * Serve blank map tiles locally so map tests don't depend on the internet or OpenStreetMap's servers.
 * Applied to every test's default context, and to contexts opened with signIn.
 * @param context - Browser context to route.
 */
export async function blockMapTiles(context: BrowserContext) {
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: TILE }));
}

// Specs import `test` and `expect` from here instead of '@playwright/test'.
// The dashboard's "Retry headed" sets PW_KEEP_OPEN=1: when the test ends, the browser stays open with the
// Playwright Inspector so you can look around the app. Press Resume (or close the browser) to finish.
// page.pause() does nothing in headless runs, so normal runs are unaffected.
export const test = base.extend<{ keepOpen: void, offlineMap: void }>({
  offlineMap: [async ({ context }, use) => {
    await blockMapTiles(context);
    await use();
  }, { auto: true }],
  keepOpen: [async ({ page }, use) => {
    await use();
    if (process.env.PW_KEEP_OPEN === '1' && !page.isClosed()) await page.pause();
  }, { auto: true }],
});

export { expect };
