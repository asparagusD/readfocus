// C35.5b-c (issue 20): a page keeps its last data. Coming back to the Library or the Dashboard shows it at once,
// before any request has answered, and asks again behind it; League's settings use the progress the header
// already asked for instead of waiting for a request of their own after the league. Mocked API.
import { test, expect, BOOK, LEAGUE, PROGRESS } from './fixtures.js';

const SHELVED = { id: BOOK, title: 'Walden', author: 'Henry David Thoreau', status: 'ready', file_type: 'pdf',
  total_chunks: 3, total_words: 900, created_at: '2026-11-01T00:00:00Z', cover_url: null, storage_mode: 'cloud',
  progress: null };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const nav = (page, name) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();

/** Hold every GET to `path` until the returned function is called; counts the GETs held. */
async function hold(page, path, body) {
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  const held = { count: 0, release: () => release() };
  await page.route(`http://localhost:8000${path}`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (route.request().method() !== 'GET') return route.fallback();
    held.count += 1;
    await released;
    return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  });
  return held;
}

test('back on the Library, the shelf shows before /books answers, and is asked again', async ({ page, api }) => {
  api.shelf = [SHELVED];
  await page.goto('/');
  await expect(page.locator('.rf-shelf__item')).toHaveCount(1);
  await nav(page, 'Dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.rf-dash')).toBeVisible();
  const books = await hold(page, '/books', [SHELVED, { ...SHELVED, id: 'second', title: 'Middlemarch' }]);
  await nav(page, 'Library');
  await expect(page.locator('.rf-shelf__item')).toHaveCount(1); // the kept shelf, the request still held
  await expect.poll(() => books.count).toBe(1); // and it was asked again
  books.release();
  await expect(page.locator('.rf-shelf__item')).toHaveCount(2); // the fresh answer replaces it
});

test('back on the Dashboard, its figures show before /dashboard answers', async ({ page, api }) => {
  api.shelf = [SHELVED];
  await page.route('http://localhost:8000/dashboard', (route) => route.fulfill({ status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ book_progress: [], words_this_week: 4200,
      score_over_time: [{ date: '2026-11-14', score_pct: 70, book_id: BOOK, book_title: 'Walden' }], reading_streak: 2,
      recent_feedback: [], focus_this_week: { seconds: 0, points: 0, sessions: 0 } }) }));
  await page.goto('/dashboard');
  await expect(page.getByText('4,200')).toBeVisible();
  await nav(page, 'Library');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.rf-shelf__item')).toHaveCount(1);
  const dashboard = await hold(page, '/dashboard', { book_progress: [], words_this_week: 5000, score_over_time: [],
    reading_streak: 2, recent_feedback: [], focus_this_week: { seconds: 0, points: 0, sessions: 0 } });
  await nav(page, 'Dashboard');
  await expect(page.getByText('4,200')).toBeVisible(); // kept; no skeleton
  await expect(page.getByLabel('Loading your progress')).toHaveCount(0);
  await expect.poll(() => dashboard.count).toBe(1);
  dashboard.release();
});

test('League: the settings use the header\'s progress, so no second request waits behind the league', async ({ page, api }) => {
  api.progress = structuredClone(PROGRESS);
  let progressGets = 0;
  page.on('request', (r) => { if (r.method() === 'GET' && r.url().endsWith('/me/progress')) progressGets += 1; });
  const league = await hold(page, '/leagues/current', LEAGUE);
  await page.goto('/league');
  await expect.poll(() => progressGets).toBe(1); // asked while the league is still on its way
  league.release();
  const settings = page.getByRole('region', { name: 'Your league settings' });
  await expect(settings.getByLabel('Display name')).toBeVisible();
  expect(progressGets).toBe(1); // the settings asked nothing more
});
