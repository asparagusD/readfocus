// The header's progress (C24.6a, handoff screen 26 and the app bar): candle, goal ring, level; one calm celebration.
import { test, expect, PROGRESS } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const link = (page) => page.getByRole('link', { name: /^Level \d+/ });

test('the header reads the level, today, the streak and its freezes as one link to the dashboard', async ({ page }) => {
  await page.goto('/');
  const progress = link(page);
  await expect(progress).toHaveAccessibleName(
    'Level 3, 490 of 750 XP to level 4. Today 30 of 50 XP. 7 days in a row, 1 freeze saved. Open your progress.');
  await expect(progress).toContainText('7');
  await expect(progress).toContainText('Level 3');
  await expect(progress.locator('.rf-hp__drop.is-held')).toHaveCount(1);
  await expect(progress.locator('.rf-hp__drop')).toHaveCount(2);
  const bar = await progress.locator('.rf-hp__bar span').evaluate((el) => el.style.transform);
  expect(Number(bar.match(/scaleX\(([\d.]+)\)/)[1])).toBeCloseTo(490 / 750, 4);
  const box = await progress.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  if (shots) await page.screenshot({ path: `${shots}/header-progress-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 80 } });
  await progress.focus();
  await expect(progress).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('a new reader sees an unlit candle and encouragement, never a warning', async ({ page, api }) => {
  api.progress = { ...PROGRESS, total_xp: 0, today: { ...PROGRESS.today, xp: 0 }, streak: { days: 0, freezes: 0, frozen_days: [] } };
  await page.goto('/');
  const progress = link(page);
  await expect(progress).toHaveAccessibleName(/A new streak starts with today’s goal\./);
  await expect(progress.locator('.rf-hp__flame')).toHaveCount(0);
  await expect(progress.locator('.rf-hp__arc')).toHaveCount(0);
});

test('meeting the goal is celebrated once that day, with a polite announcement', async ({ page, api }) => {
  api.progress = { ...PROGRESS, today: { ...PROGRESS.today, xp: 60, met: true } };
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: "Today's goal is met." })).toBeAttached();
  await expect(page.locator('.rf-hp__halo')).toBeAttached();
  await expect(link(page)).toHaveAccessibleName(/Today's goal is met, 60 XP\./);
  if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/header-goal-met-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 80 } }); }
  await page.reload();
  await expect(link(page)).toBeVisible();
  await expect(page.locator('.rf-hp__halo')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: "Today's goal is met." })).toHaveCount(0);
});

test('under reduced motion the celebration is still and the flame does not flicker', async ({ page, api }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  api.progress = { ...PROGRESS, today: { ...PROGRESS.today, xp: 60, met: true } };
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: "Today's goal is met." })).toBeAttached();
  await expect(page.locator('.rf-hp__halo')).toHaveCount(0);
  const flicker = await page.locator('.rf-hp__flame path').evaluate((el) => getComputedStyle(el).animationName);
  expect(flicker).toBe('none');
});

test('if progress cannot be read the header simply leaves it out', async ({ page, api }) => {
  api.progress = null;
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
  await expect.poll(() => api.progressReads).toBeGreaterThan(0);
  await expect(link(page)).toHaveCount(0);
});

for (const theme of ['paper', 'lamplight']) {
  test(`at 375 in ${theme} the candle fits beside the links, with no sideways scroll`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('rf-theme', t), theme);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const progress = link(page);
    await expect(progress).toBeVisible();
    await expect(progress.locator('.rf-hp__level')).toBeHidden();
    await expect(progress.locator('.rf-hp__goal')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    const box = await progress.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    if (shots) await page.screenshot({ path: `${shots}/header-progress-375-${theme}.png`, clip: { x: 0, y: 0, width: 375, height: 70 } });
  });
}
