import { defineConfig } from 'cypress';
import { loadEnv } from 'vite';

export default defineConfig({
  projectId: 'j1hcn8',
  video: false,
  e2e: {
    baseUrl: 'http://localhost:5173',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: false,
    setupNodeEvents(on, config) {
      const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
      const isLocal = value => {
        try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname); }
        catch { return false; }
      };
      if (!isLocal(config.baseUrl) || !isLocal(env.SUPABASE_URL)) {
        throw new Error('Cypress requires a local baseUrl and local SUPABASE_URL. Restart the app with the same local environment before testing.');
      }
      on('task', {
        loginCredentials() {
          if (!env.E2E_EMAIL || !env.E2E_PASSWORD) {
            throw new Error('Set E2E_EMAIL and E2E_PASSWORD in .env.local to a confirmed local test account with a completed profile.');
          }
          return { email: env.E2E_EMAIL, password: env.E2E_PASSWORD };
        },
      });
      return config;
    },
  },
});
