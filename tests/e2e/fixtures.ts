import { test as base, expect } from '@playwright/test';

// Specs import `test` and `expect` from here instead of '@playwright/test'.
// The dashboard's "Retry headed" sets PW_KEEP_OPEN=1: when the test ends, the browser stays open with the
// Playwright Inspector so you can look around the app. Press Resume (or close the browser) to finish.
// page.pause() does nothing in headless runs, so normal runs are unaffected.
export const test = base.extend<{ keepOpen: void }>({
  keepOpen: [async ({ page }, use) => {
    await use();
    if (process.env.PW_KEEP_OPEN === '1' && !page.isClosed()) await page.pause();
  }, { auto: true }],
});

export { expect };
