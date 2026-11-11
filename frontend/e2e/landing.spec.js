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
