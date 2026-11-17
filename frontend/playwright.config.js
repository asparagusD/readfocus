import { defineConfig } from '@playwright/test';

// E2E for the reader and word lookup (C12.10). Runs on the installed Microsoft Edge (no browser
// download) against a production build under `vite preview`, with every backend and Supabase call
// answered by e2e/fixtures.js: offline, $0, no account. Not a standard check yet.
const FRAME_RATE = /page-turn frame rate/;

export default defineConfig({
  testDir: './e2e',
  // live, opt-in: npm run test:live (playwright.live.config.js); Gate G5's renderer walk (playwright.gate.config.js)
  testIgnore: ['journey.spec.js', 'phase2_journey.spec.js', 'gate-g5.spec.js'],
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    // On CI only: a failure keeps its trace and screenshot, which the e2e job uploads.
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
  },
  // The page-turn frame-rate benchmark runs with no recorder: a trace's screencast takes frames from the page it
  // measures (on a 2-CPU Linux runner, 60 fps fell to 20.7; DEBUG_LOG 2026-11-17 C25.5). Recording settings
  // cannot change inside a spec file, so the benchmark is its own project.
  projects: [
    { name: 'e2e', grepInvert: FRAME_RATE },
    { name: 'frame-rate', grep: FRAME_RATE, use: { trace: 'off', screenshot: 'off' } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
