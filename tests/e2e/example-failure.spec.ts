import { test, expect } from './fixtures';
import { login } from './testHelpers';

// Deliberate failure for trying out the dashboard's failure views, retries and AI analysis.
// It always fails, so exclude it from normal runs with: npm run test:e2e -- --grep-invert @example
test('example failure: logs in then expects true to be false', { tag: '@example' }, async ({ page }) => {
  await test.step('Log in', async () => {
    // Sign in using the configured local test account.
    await login(page);
    await page.pause();
  });

  await test.step('Fail on purpose', async () => {
    // Always fails: an example of an assertion failure after a successful UI step.
    expect(true, 'Example failure: true should be false').toBe(false);
  });
});
