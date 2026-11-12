import { defineConfig } from '@playwright/test';

// The live reading journey (C15.1): e2e/journey.spec.js against a real backend and the shared
// Supabase project. Never a standard check: it signs in as test user A, uploads sample.pdf and
// deletes it again. Run with `npm run test:live`.
//   BASE_URL unset    -> Vite dev on http://localhost:5175 (frontend/.env), backend on :8000
//                        started separately (`make dev-backend`).
//   BASE_URL=https://readfocus-lake.vercel.app -> production; the API defaults to Render.
// API_URL overrides the API origin the spec waits on and checks hosts against.
const local = !process.env.BASE_URL;
const baseURL = process.env.BASE_URL ?? 'http://localhost:5175';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'journey.spec.js',
  timeout: 20 * 60_000, // a cold Render start plus ingestion of a 13-page PDF
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    // One stuck click or page must fail on its own, leaving the run's budget to the cleanup in
    // the spec's finally (a first production run spent all 20 minutes on one click).
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
  },
  ...(local ? {
    webServer: {
      command: 'npx vite --port 5175 --strictPort',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  } : {}),
});
