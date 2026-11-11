// The 404 page and the error boundary (C13.8a), with the API mocked.
import { test, expect } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

test('an unknown address gets the 404 page inside the shell, and its link leads home', async ({ page }) => {
  await page.goto('/no/such/page');
  await expect(page.getByRole('heading', { level: 1, name: 'This page isn’t on the shelf.' })).toBeVisible();
  await expect(page).toHaveTitle('Page not found · ReadFocus');
  await expect(page.getByText('404 · /no/such/page')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
  if (shots) await page.screenshot({ path: `${shots}/not-found-1440.png` });
  await page.getByRole('link', { name: 'Back to your shelf' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
});

test('a page that fails to render shows the error screen; Back and the shelf link clear it', async ({ page }) => {
  page.on('pageerror', () => {}); // the render error is expected
  // A payload no page expects: the dashboard cannot draw a number as its list of scores.
  await page.route('http://localhost:8000/dashboard', (route) => (route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ score_over_time: 5, book_progress: 5 }) })));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'This page didn’t open properly.' })).toBeVisible();
  await page.goBack(); // a new address clears the error without a reload
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: 'This page didn’t open properly.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload the page' })).toBeVisible();
  await expect(page.getByText('TypeError', { exact: true })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/render-error-1440.png` });
  await page.getByRole('link', { name: 'Back to your shelf' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
});
