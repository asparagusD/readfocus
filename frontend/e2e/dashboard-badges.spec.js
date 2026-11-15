// The badge shelf on the Dashboard (C24.6b, handoff screen 26), with GET /badges from the fixtures.
import { test, expect } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const DASHBOARD = { reading_streak: 3, words_this_week: 4200, focus_this_week: { seconds: 1800, points: 300, sessions: 1 },
  score_over_time: [{ date: '2026-11-14', score_pct: 70, book_id: 'walden', book_title: 'Walden' }],
  book_progress: [{ book_id: 'walden', title: 'Walden', author: 'Henry David Thoreau', total_chunks: 10, chunks_completed: 3,
    progress_pct: 30, avg_score: 70, sessions_completed: 3, est_sessions_to_finish: 7 }], recent_feedback: [] };
const mockDashboard = (page) => Promise.all([
  page.route('http://localhost:8000/dashboard', (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(DASHBOARD) })),
  page.route(/localhost:8000\/mastery\?/, (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [], total: 0, limit: 10, offset: 0 }) })),
]);
const shelf = (page) => page.getByRole('region', { name: 'Badge shelf' });

test('the shelf shows all fourteen, earned ones inked with their day and locked ones with how to earn them', async ({ page }) => {
  await mockDashboard(page);
  await page.goto('/dashboard');
  const region = shelf(page);
  await expect(region.getByRole('heading', { name: 'Badge shelf' })).toBeVisible();
  await expect(region).toContainText('1 of 14 earned');
  await expect(region.getByRole('listitem')).toHaveCount(14);
  const earned = region.locator('.rf-badge.is-earned');
  await expect(earned).toHaveCount(1);
  await expect(earned).toContainText('First focus session');
  await expect(earned).toContainText('Earned 10 Nov 2026');
  const locked = region.getByRole('listitem').filter({ hasText: '7-day streak' });
  await expect(locked).toContainText('Meet your daily goal 7 days running.');
  await expect(locked).toContainText('Not earned yet.');
  await expect(region.locator('.rf-badge__plate')).toHaveCount(3); // the book badges are bookplates
  if (shots) await region.screenshot({ path: `${shots}/badge-shelf-1440.png` });
});

test('before any badge the shelf nudges kindly', async ({ page, api }) => {
  api.badgesEarned = {};
  await mockDashboard(page);
  await page.goto('/dashboard');
  await expect(shelf(page)).toContainText('Your first badge comes with your first focus session');
  await expect(shelf(page).locator('.rf-badge.is-earned')).toHaveCount(0);
});

test('a newly earned badge stamps in once on this device', async ({ page, api }) => {
  api.badgesEarned = { first_focus: '2026-11-10T12:00:00+00:00', streak_7: '2026-11-17T12:00:00+00:00' };
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('rf-badges-seen', '["first_focus"]'); sessionStorage.setItem('seeded', '1'); } });
  await mockDashboard(page);
  await page.goto('/dashboard');
  await expect(shelf(page).locator('[data-stamp]')).toHaveCount(1);
  await expect(shelf(page).getByRole('listitem').filter({ hasText: '7-day streak' }).locator('[data-stamp]')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('rf-badges-seen'))).toBe('["first_focus","streak_7"]');
  await page.reload();
  await expect(shelf(page).locator('.rf-badge.is-earned')).toHaveCount(2);
  await expect(shelf(page).locator('[data-stamp]')).toHaveCount(0);
});

test('under reduced motion nothing stamps', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockDashboard(page);
  await page.goto('/dashboard');
  await expect(shelf(page).locator('.rf-badge.is-earned')).toHaveCount(1);
  await expect(shelf(page).locator('[data-stamp]')).toHaveCount(0);
});

test('if the badges do not load the shelf says so calmly', async ({ page }) => {
  await mockDashboard(page);
  await page.route('http://localhost:8000/badges', (route) => route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: '{"detail":"down"}' }));
  await page.goto('/dashboard');
  await expect(shelf(page)).toContainText('Your badges didn’t load. They are safe; try again in a moment.');
});

for (const theme of ['paper', 'lamplight']) {
  test(`at 375 in ${theme} the shelf is two badges wide with no sideways scroll`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('rf-theme', t), theme);
    await page.setViewportSize({ width: 375, height: 812 });
    await mockDashboard(page);
    await page.goto('/dashboard');
    const items = shelf(page).getByRole('listitem');
    await expect(items).toHaveCount(14);
    const [a, b, c] = await Promise.all([0, 1, 2].map((i) => items.nth(i).boundingBox()));
    expect(Math.round(a.y)).toBe(Math.round(b.y));
    expect(c.y).toBeGreaterThan(a.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    if (shots) await shelf(page).screenshot({ path: `${shots}/badge-shelf-375-${theme}.png` });
  });
}
