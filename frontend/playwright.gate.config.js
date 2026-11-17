import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Gate G5 (C18.G): e2e/gate-g5.spec.js pages through every test EPUB in the original view and
// counts the images, captions and MathML it draws. Offline like the e2e (every API call mocked),
// but slow and it reads the git-ignored shelf, so it is not a standard check:
//   G5_EXPECT=<json from scripts/dev/g5_epub_expect.py> npx playwright test -c playwright.gate.config.js
export default defineConfig({ ...base, testIgnore: [], testMatch: 'gate-g5.spec.js', timeout: 10 * 60_000 });
