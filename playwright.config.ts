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
// Lets account tests confirm sign-ups without reading email. Only this test server gets it, and auth.mjs
// refuses it outside local, non-production Supabase. Real codes are 6 digits, so 0000 cannot collide.
process.env.E2E_CONFIRM_CODE = '0000';
// Account cleanup removes leftover test accounts through the local Supabase admin API.
process.env.E2E_SUPABASE_URL = env.SUPABASE_URL;
process.env.E2E_ADMIN_KEY = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';

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
    env: { ...env, PORT: '5174', HOST: '127.0.0.1', NODE_ENV: 'development', E2E_CONFIRM_CODE: process.env.E2E_CONFIRM_CODE },
  },
});
