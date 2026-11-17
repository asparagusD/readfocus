import { defineConfig } from '@playwright/test';
import live from './playwright.live.config.js';

// The phase-2 journey (C25.3): e2e/phase2_journey.spec.js, live like the C15 journey (same base URL, API and
// web server rules), with room for two real ingestions and region maps, a focus session and its quiz. Never a
// standard check: run with `npm run test:live:phase2`, only with approval.
export default defineConfig({ ...live, testMatch: 'phase2_journey.spec.js', timeout: 60 * 60_000 });
