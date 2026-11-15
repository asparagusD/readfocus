// The weekly league page (C24.6c, handoff screen 27), with GET /leagues/current from the fixtures (LEAGUE).
import { test, expect, LEAGUE } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
// The week ends 4 days, 9 hours and 30 minutes from now (no fake clock: the fixtures' session must stay fresh).
const ENDS = () => new Date(Date.now() + ((4 * 24 + 9) * 60 + 30) * 60_000).toISOString();

test.beforeEach(async ({ api }) => { api.league.week.ends_at = ENDS(); });

test('the league page shows the tier, time left, my ranked group with soft zone lines, and last week', async ({ page }) => {
  await page.goto('/league');
  await expect(page.getByRole('heading', { level: 1, name: 'Hardcover league' })).toBeVisible();
  await expect(page.getByText('This week · 4 days, 9 hours left · Monday 00:00 UTC')).toBeVisible();
  const tiers = page.getByRole('list', { name: 'Tiers, lowest first' }).getByRole('listitem');
  await expect(tiers).toHaveText(['Pamphlet', 'Paperback', 'Hardcover', 'Folio', 'First Edition', 'Illuminated']);
  await expect(tiers.nth(2)).toHaveAttribute('aria-current', 'step');

  const group = page.getByRole('region', { name: 'Your group this week' });
  const items = group.getByRole('listitem');
  await expect(items.nth(3)).toHaveText('Promotion zone · the top 3 move up to Folio');
  const me = group.locator('[aria-current="true"]');
  await expect(me).toContainText('4');
  await expect(me).toContainText('Quiet Owl (you)');
  await expect(me).toContainText('502 XP');
  await expect(group.locator('.rf-standing')).toHaveCount(LEAGUE.rows.length);
  await expect(group.locator('.rf-standing__gap')).toHaveCount(1); // rank 7 keeps off others' boards
  const texts = await items.allInnerTexts();
  const down = texts.findIndex((t) => t.includes('The bottom 2 move to Paperback next week'));
  expect(texts[down + 1]).toContain('Reader 9c01');
  await expect(page.getByRole('region', { name: 'Last week' }))
    .toContainText('Last week you came 2nd of 9 with 380 XP and moved up to Hardcover.');
  await expect(page.getByRole('region', { name: 'How leagues work' })).toContainText('Nothing to buy, no extra lives.');
  await expect(page.getByRole('link', { name: 'League' })).toHaveAttribute('aria-current', 'page');
  if (shots) await page.screenshot({ path: `${shots}/league-1440.png`, fullPage: true });
});

test('a reader not yet in a group is told how they join', async ({ page, api }) => {
  api.league = { ...LEAGUE, in_group: false, zones: null, rows: [], tier: 'Pamphlet', last_week: null };
  await page.goto('/league');
  await expect(page.getByRole('heading', { level: 1, name: 'Pamphlet league' })).toBeVisible();
  await expect(page.getByText('Read in focus mode this week and you will join a Pamphlet group next Monday.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Last week' })).toHaveCount(0);
});

test('a reader who opted out is reminded only they see their place', async ({ page, api }) => {
  api.league = { ...LEAGUE, opted_out: true };
  await page.goto('/league');
  await expect(page.getByText('You keep yourself off other readers’ boards; only you see your place here.')).toBeVisible();
});

test('if the league does not load the page says so calmly', async ({ page, api }) => {
  api.league = null;
  await page.goto('/league');
  await expect(page.getByRole('alert')).toContainText('Your league didn’t load.');
  await expect(page.getByRole('alert')).toContainText('Your XP and place are safe.');
});

test('the League link is reached by keyboard and opens the page', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'League' });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/league$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Hardcover league' })).toBeVisible();
});

for (const theme of ['paper', 'lamplight']) {
  test(`at 375 in ${theme} the page and the header fit with no sideways scroll`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('rf-theme', t), theme);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/league');
    await expect(page.getByRole('heading', { level: 1, name: 'Hardcover league' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    for (const name of ['Library', 'Dashboard', 'League']) {
      const box = await page.getByRole('link', { name, exact: true }).boundingBox();
      expect(box.x + box.width, name).toBeLessThanOrEqual(375);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    if (shots) await page.screenshot({ path: `${shots}/league-375-${theme}.png`, fullPage: true });
  });
}
