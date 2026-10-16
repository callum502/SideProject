import { defineConfig } from '@playwright/test';
import { loadEnv } from 'vite';

const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
const baseURL = 'http://127.0.0.1:5174';
function isLocal(value: string | undefined) {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value!).hostname); }
  catch { return false; }
}
if (!isLocal(env.SUPABASE_URL)) {
  throw new Error('Browser tests require SUPABASE_URL to point to local Supabase. Check .env.local.');
}
process.env.E2E_EMAIL = env.E2E_EMAIL || '';
process.env.E2E_PASSWORD = env.E2E_PASSWORD || '';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60000,
  expect: { timeout: 20000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { ...env, PORT: '5174', HOST: '127.0.0.1', NODE_ENV: 'development' },
  },
});
