import { defineConfig } from '@playwright/test';

// E2E for the reader and word lookup (C12.10). Runs on the installed Microsoft Edge (no browser
// download) against a production build under `vite preview`, with every backend and Supabase call
// answered by e2e/fixtures.js: offline, $0, no account. Not a standard check yet.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
