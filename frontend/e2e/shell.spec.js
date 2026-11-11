// The app shell (C13.2a), with the API mocked.
import { test, expect } from './fixtures.js';

test('every page has its own title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Your shelf · ReadFocus');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page).toHaveTitle('Dashboard · ReadFocus');
});
