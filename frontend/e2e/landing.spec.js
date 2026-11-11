// The public landing page (C13.10): signed-out visitors at "/" see it, signed-in readers still
// get their shelf, and every deep link behaves as before.
import { test, expect } from './fixtures.js';

const API = 'http://localhost:8000';

/** Every backend request the page makes, as "METHOD /path". */
function backendCalls(page) {
  const calls = [];
  page.on('request', (r) => { if (r.url().startsWith(API) && r.method() !== 'OPTIONS') calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  return calls;
}

test.describe('signed out', () => {
  test.use({ signedIn: false });

  test('"/" shows the landing page and only wakes the backend once', async ({ page }) => {
    const calls = backendCalls(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'A quiet place to read deeply.' })).toBeVisible();
    await expect(page.locator('.rf-warm')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(calls).toEqual(['GET /health']);
  });

  test('the landing page shows at once even when the backend never answers', async ({ page }) => {
    await page.route(`${API}/health`, (route) => route.abort());
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'A quiet place to read deeply.' })).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(page.locator('.rf-warm')).toHaveCount(0);
  });

  test('Start reading opens Create account; Sign in opens sign in', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Start reading' }).first().click();
    await expect(page).toHaveURL(/\/login\?tab=signup$/);
    await expect(page.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  });

  test('deep links still send signed-out visitors to sign in', async ({ page }) => {
    for (const path of ['/dashboard', '/read/e2e-book', '/results/e2e-session']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });
});

test('signed in, "/" is still the shelf', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A quiet place to read deeply.' })).toHaveCount(0);
});

test.describe('hero and how it works', () => {
  test.use({ signedIn: false });

  test('the book spread cites its source and the flyleaf turns over once', async ({ page }) => {
    await page.goto('/');
    const spread = page.locator('.rf-spread');
    await expect(spread.getByText('The Fourth Book').first()).toBeVisible();
    await expect(spread.getByRole('link', { name: 'Project Gutenberg' })).toHaveAttribute('href', 'https://www.gutenberg.org/ebooks/2680');
    const leaf = page.locator('.rf-spread__leaf');
    await expect(leaf).toHaveCount(1);
    // Turned over at the spine: rotateY(-180deg) leaves a matrix3d with m11 = -1.
    await expect.poll(() => leaf.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m11), { timeout: 5000 }).toBeCloseTo(-1, 2);
  });

  test('See how it works moves to the contents page and focus follows', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'See how it works' }).click();
    await expect(page.locator('#how-it-works')).toBeFocused();
    const steps = page.locator('#how-it-works li');
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(3)).toBeVisible();
    await expect(steps.nth(0)).toContainText('Upload a PDF or EPUB');
    await expect(steps.nth(3)).toContainText('Your next session adapts');
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('no flyleaf is drawn and the steps do not move', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.rf-spread__text').first()).toBeVisible();
      await expect(page.locator('.rf-spread__leaf')).toHaveCount(0);
      await page.locator('#how-it-works').scrollIntoViewIfNeeded();
      await expect(page.locator('#how-it-works li').last()).toHaveCSS('opacity', '1');
      const transforms = await page.locator('#how-it-works li').evaluateAll((items) => items.map((el) => getComputedStyle(el).transform));
      expect(transforms).toEqual(['none', 'none', 'none', 'none']);
    });
  });
});
