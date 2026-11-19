// C35.5d (issue 20): moving between pages never leaves the main area blank. While a page's code is on its way the
// main area shows a skeleton; pointing at a nav link loads that page's code and data first. Mocked API.
import { test, expect } from './fixtures.js';

/** Every animation frame, whether <main> showed nothing: no text and no skeleton. */
async function recordBlank(page) {
  await page.addInitScript(() => {
    window.__blankFrames = 0;
    const tick = () => {
      const main = document.querySelector('main');
      if (main && !main.innerText.trim() && !main.querySelector('.rf-skeleton')) window.__blankFrames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

test('a page whose code is slow shows a skeleton, never an empty main area', async ({ page }) => {
  await recordBlank(page);
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  await page.route(/\/assets\/Dashboard-[^/]+\.js$/, async (route) => { await slow; return route.fallback(); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /^Your shelf/ })).toBeVisible();
  await page.evaluate(() => { window.__blankFrames = 0; });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByLabel('Loading the page')).toBeVisible(); // the code is held: the skeleton stands in
  if (process.env.E2E_SHOTS) {
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/page-skeleton-1440.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/page-skeleton-375.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  }
  release();
  await expect(page.locator('.rf-dash')).toBeVisible();
  expect(await page.evaluate(() => window.__blankFrames)).toBe(0);
});

test('pointing at a nav link loads that page\'s code and data before the click', async ({ page }) => {
  const seen = [];
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /^Your shelf/ })).toBeVisible();
  page.on('request', (r) => seen.push(new URL(r.url()).pathname));
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'League' }).hover();
  await expect.poll(() => seen.includes('/leagues/current')).toBe(true);
  expect(seen.some((p) => /\/assets\/League-[^/]+\.js$/.test(p)) || await page.evaluate(() =>
    performance.getEntriesByType('resource').some((e) => /\/assets\/League-[^/]+\.js$/.test(e.name)))).toBe(true);
});
