// "Use your own free Gemini key" in the account panel (C20.3): save, refuse, remove; the key is never
// shown again, never kept in the page, and the panel still fits a phone.
import { test, expect, GOOD_KEY } from './fixtures.js';

const shots = process.env.E2E_SHOTS;

async function openKeyForm(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account and reading settings' }).click();
  const toggle = page.getByRole('button', { name: 'Use your own free Gemini key' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return page.getByLabel('Gemini API key');
}

test('a good key is saved, shown only by its last four, and can be removed', async ({ page, api }) => {
  const field = await openKeyForm(page);
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'off');
  const link = page.getByRole('link', { name: /Get a free key in Google AI Studio/ });
  await expect(link).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByText('your own daily quota, not the shared one. The key is encrypted and never shown again.')).toBeVisible();
  await field.fill(`  ${GOOD_KEY}\n`);
  if (shots) await page.screenshot({ path: `${shots}/ownkey-form-1440.png` });
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('Key ending in ij12')).toBeVisible();
  expect(api.steveKeyPuts).toEqual([GOOD_KEY]); // trimmed before it was sent
  await expect(page.getByLabel('Gemini API key')).toHaveCount(0);
  expect(await page.content()).not.toContain(GOOD_KEY);
  if (shots) await page.screenshot({ path: `${shots}/ownkey-saved-1440.png` });
  await page.getByRole('button', { name: 'Remove key' }).click();
  await expect(page.getByLabel('Gemini API key')).toBeVisible();
  await expect(page.getByText('Key ending in')).toHaveCount(0);
});

test('a key Google refuses shows why, is cleared, and nothing is saved', async ({ page, api }) => {
  const field = await openKeyForm(page);
  await field.fill('AIzaSyRevokedKey-not-real-zyxwvutsrq9876');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('Google did not accept this key.', { exact: false })).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(api.steveKey).toBeNull();
  if (shots) await page.screenshot({ path: `${shots}/ownkey-refused-1440.png` });
});

test('something that is not a key is caught before it is sent', async ({ page, api }) => {
  const field = await openKeyForm(page);
  await field.fill('my password');
  await field.press('Enter');
  await expect(page.getByText('Paste the whole key from Google AI Studio.')).toBeVisible();
  expect(api.steveKeyPuts).toEqual([]);
});

test.describe('at 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the open form fits the panel and the page does not scroll sideways', async ({ page }) => {
    const field = await openKeyForm(page);
    await expect(field).toBeVisible();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sideways).toBeLessThanOrEqual(0);
    const panel = await page.locator('.rf-account__panel').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(375);
    for (const name of ['Save key', 'Use your own free Gemini key']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    if (shots) await page.screenshot({ path: `${shots}/ownkey-form-375.png`, fullPage: true });
  });
});

test.describe('on a short phone (375 x 667)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('the panel scrolls inside itself so Save key and Sign out stay reachable, in Lamplight too', async ({ page }) => {
    await openKeyForm(page);
    const panel = page.locator('.rf-account__panel');
    const box = await panel.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(667);
    await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Lamplight (dark)' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'lamplight');
    const save = page.getByRole('button', { name: 'Save key' });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/ownkey-form-375-lamplight.png` }); }
  });
});
