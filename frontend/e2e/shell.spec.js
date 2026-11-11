// The app shell (C13.2a): top bar, account panel, mobile layout and page titles, with the API mocked.
import { test, expect } from './fixtures.js';

const shots = process.env.E2E_SHOTS; // a folder: save screenshots there for the design review

test('the bar marks the current page and every page has its own title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Your shelf · ReadFocus');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page).toHaveTitle('Dashboard · ReadFocus');
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Library' })).not.toHaveAttribute('aria-current', 'page');
  if (shots) await page.screenshot({ path: `${shots}/shell-1440.png` });
});

test('the skip link is the first stop and leads to the page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('the account panel: initials, settings, Esc and a press outside', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Account and reading settings' });
  await expect(button).toHaveText('R');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator(`#${await button.getAttribute('aria-controls')}`);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('reader@e2e.test');
  // Text size and accent are radios; Tab reaches the size group first.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: 'Medium' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Large' })).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('rf-text-size'))).toBe('19.5');
  await page.getByRole('radio', { name: 'Sage' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'sage');
  if (shots) await page.screenshot({ path: `${shots}/account-1440.png` });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
  await button.click();
  await expect(panel).toBeVisible();
  await page.locator('#main').click({ position: { x: 5, y: 5 } });
  await expect(panel).toBeHidden();
});

test('sign out leaves for the sign-in page', async ({ page }) => {
  await page.route(/supabase\.co\/auth\/v1\/logout/, (route) => route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Account and reading settings' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test.describe('at 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('links stay in the bar and the theme moves into the panel', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Library' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    for (const box of await page.locator('.rf-topbar a, .rf-topbar button').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: 'Account and reading settings' }).click();
    const theme = page.getByRole('radiogroup', { name: 'Theme' });
    await expect(theme).toBeVisible();
    await theme.getByRole('radio', { name: 'Lamplight (dark)' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'lamplight');
    const panel = await page.locator('.rf-account__panel').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(16);
    expect(panel.x + panel.width).toBeLessThanOrEqual(375 - 16);
    if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/account-375-lamplight.png` }); } // after the theme cross-fade
  });
});
