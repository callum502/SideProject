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
  workers: 3,
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
    // The test dashboard's Slow-mo option sets PW_SLOW_MO (ms) to pause before each browser action.
    launchOptions: { slowMo: Number(process.env.PW_SLOW_MO) || 0 },
    // The dashboard's Record video option sets PW_VIDEO=1: record every test and draw each action
    // onto the video (red dot at the click point, outline on the target element, action title).
    // Playwright holds each annotation for `duration` before the next action, so recorded runs are slower.
    video: process.env.PW_VIDEO === '1' ? {
      mode: 'on',
      show: {
        actions: {
          duration: 600,
          style: {
            point: 'width: 22px; height: 22px; border-radius: 50%; background: rgba(239, 68, 68, .45); box-shadow: 0 0 0 3px rgba(239, 68, 68, .9)',
            highlight: 'outline: 3px solid rgba(239, 68, 68, .9); outline-offset: 2px; background: rgba(239, 68, 68, .1)',
            title: 'font-size: 16px',
          },
        },
        test: { level: 'step', position: 'top-left', fontSize: 14 },
      },
    } : 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 60000,
    // All workers share 127.0.0.1, so raise the per-IP rate limits for this local test server only (see request-limits.mjs).
    env: { ...env, PORT: '5174', HOST: '127.0.0.1', NODE_ENV: 'development', E2E_CONFIRM_CODE: process.env.E2E_CONFIRM_CODE, E2E_RELAX_LIMITS: '1' },
  },
});
