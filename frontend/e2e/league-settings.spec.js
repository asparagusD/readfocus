// League settings on the league page (C24.6d): display name, daily goal and the leaderboard opt-out.
import { test, expect } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const settings = (page) => page.getByRole('region', { name: 'Your league settings' });

test('the settings show what is saved and send only what changed', async ({ page, api }) => {
  await page.goto('/league');
  const form = settings(page);
  await expect(form.getByLabel('Display name')).toHaveValue('');
  await expect(form.getByLabel('Daily goal (XP)')).toHaveValue('50');
  await expect(form.getByLabel('Keep me off other readers’ boards')).not.toBeChecked();
  await form.getByLabel('Display name').fill('  Quiet   Owl ');
  await form.getByLabel('Daily goal (XP)').fill('120');
  await form.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Your league settings are saved.')).toBeVisible();
  expect(api.progressPuts).toEqual([{ display_name: 'Quiet Owl', daily_goal: 120 }]);
  await expect(form.getByLabel('Display name')).toHaveValue('Quiet Owl');
  if (shots) await page.screenshot({ path: `${shots}/league-settings-1440.png`, fullPage: true });
});

test('opting out is saved and the page says so at once', async ({ page, api }) => {
  await page.goto('/league');
  await settings(page).getByLabel('Keep me off other readers’ boards').check();
  await settings(page).getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(() => api.progressPuts).toEqual([{ leaderboard_opt_out: true }]);
  await expect(page.getByText('You keep yourself off other readers’ boards; only you see your place here.')).toBeVisible();
});

test('a refused name shows the server’s reason on the name field, and nothing else changes', async ({ page, api }) => {
  await page.goto('/league');
  const name = settings(page).getByLabel('Display name');
  await name.fill('Admin Owl');
  await settings(page).getByRole('button', { name: 'Save settings' }).click();
  await expect(settings(page)).toContainText('That name is reserved.');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(api.progress.display_name).toBeNull();
});

test('a goal outside 20 to 200 is caught before it is sent', async ({ page, api }) => {
  await page.goto('/league');
  const goal = settings(page).getByLabel('Daily goal (XP)');
  await goal.fill('500');
  await expect(settings(page)).toContainText('Choose a whole number from 20 to 200.');
  await expect(settings(page).getByRole('button', { name: 'Save settings' })).toBeDisabled();
  await goal.fill('200');
  await expect(settings(page).getByRole('button', { name: 'Save settings' })).toBeEnabled();
  expect(api.progressPuts).toEqual([]);
});

test('the settings work by keyboard alone', async ({ page, api }) => {
  await page.goto('/league');
  await settings(page).getByLabel('Display name').focus();
  await page.keyboard.type('Heron');
  await page.keyboard.press('Tab');
  await expect(settings(page).getByLabel('Daily goal (XP)')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(settings(page).getByLabel('Keep me off other readers’ boards')).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(settings(page).getByRole('button', { name: 'Save settings' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Your league settings are saved.')).toBeVisible();
  expect(api.progressPuts).toEqual([{ display_name: 'Heron', leaderboard_opt_out: true }]);
});

for (const theme of ['paper', 'lamplight']) {
  test(`at 375 in ${theme} the settings fit with 44 px targets`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('rf-theme', t), theme);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/league');
    const form = settings(page);
    await form.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    for (const target of [form.getByLabel('Display name'), form.getByLabel('Daily goal (XP)'),
      form.locator('.rf-lset__check'), form.getByRole('button', { name: 'Save settings' })]) {
      expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    if (shots) await form.screenshot({ path: `${shots}/league-settings-375-${theme}.png` });
  });
}
