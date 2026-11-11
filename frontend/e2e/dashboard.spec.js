// The dashboard (C13.7), with GET /dashboard (and later GET /mastery) answered here.
import { test, expect } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body, status = 200) => route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 204, headers: CORS })
  : route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
export const DASHBOARD = {
  reading_streak: 12,
  words_this_week: 18420,
  score_over_time: Array.from({ length: 10 }, (_, i) => ({ date: day(30 - i * 3), score_pct: 50 + i * 2.5, book_id: 'walden', book_title: 'Walden' })),
  book_progress: [
    { book_id: 'walden', title: 'Walden', author: 'Henry David Thoreau', total_chunks: 10, chunks_completed: 6, progress_pct: 60, avg_score: 72, sessions_completed: 6, est_sessions_to_finish: 3 },
    { book_id: 'middlemarch', title: 'Middlemarch', author: 'George Eliot', total_chunks: 40, chunks_completed: 0, progress_pct: 0, avg_score: 0, sessions_completed: 0, est_sessions_to_finish: 0 },
  ],
  recent_feedback: [
    { feedback: 'You named simplicity but missed quiet desperation. See the passage: “The mass of men lead lives of quiet desperation.”', score: 4, max_score: 10, book_title: 'Walden', date: day(1) },
  ],
};

export async function mockDashboard(page, body = DASHBOARD, { status = 200 } = {}) {
  await page.route('http://localhost:8000/dashboard', (route) => json(route, status === 200 ? body : { detail: 'down' }, status));
}

test('greeting, streak, four figures, the trend with its table, books and feedback', async ({ page }) => {
  await mockDashboard(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening)\.$/);
  await expect(page.getByText('12 days in a row')).toBeVisible();
  const stats = page.locator('.rf-dash__stats');
  await expect(stats).toContainText('18,420');
  await expect(stats).toContainText('words read this week');
  await expect(stats).toContainText('73%'); // the last of ten tests: 50 + 9 x 2.5 = 72.5, rounded half up
  await expect(stats).toContainText('books in progress');
  const table = page.getByRole('table', { name: 'Test scores, oldest first' });
  await expect(table.getByRole('row')).toHaveCount(9); // a header and the last eight tests
  await expect(page.locator('.rf-trend')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.locator('.rf-trend [tabindex]:not([tabindex^="-"])').count()).toBe(0); // nothing tabbable inside the hidden chart
  await expect(page.locator('.rf-trend .rf-trend__dot')).toHaveCount(8);
  await expect(page.locator('.rf-trend .rf-trend__dot--last')).toHaveCount(1);
  const books = page.getByRole('region', { name: 'Your books' });
  await expect(books).toContainText('60% read · 6 sessions · about 3 to finish');
  await expect(books).toContainText('0% read · 0 sessions');
  await expect(page.getByRole('region', { name: 'Recent feedback' }).locator('blockquote')).toHaveText('“The mass of men lead lives of quiet desperation.”');
  if (shots) await page.screenshot({ path: `${shots}/dashboard-1440.png`, fullPage: true });
});

test('a new reader sees a way to start, not empty charts', async ({ page }) => {
  await page.goto('/dashboard'); // the fixtures' empty dashboard
  await expect(page.getByRole('heading', { name: 'Your progress starts with a first session' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to your shelf' })).toHaveAttribute('href', '/');
  await expect(page.locator('.rf-trend')).toHaveCount(0);
});

test('a failed load says so and can try again', async ({ page }) => {
  await mockDashboard(page, null, { status: 503 });
  await page.goto('/dashboard');
  await expect(page.getByRole('alert')).toContainText('Your progress didn’t load.');
  await page.unroute('http://localhost:8000/dashboard');
  await mockDashboard(page);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('12 days in a row')).toBeVisible();
});

test.describe('at 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('figures two by two and nothing wider than the screen', async ({ page }) => {
    await mockDashboard(page);
    await page.goto('/dashboard');
    await expect(page.getByText('12 days in a row')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    const tops = await page.locator('.rf-dash__stat').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBe(tops[3]);
    expect(tops[2]).toBeGreaterThan(tops[0]);
    if (shots) await page.screenshot({ path: `${shots}/dashboard-375.png`, fullPage: true });
  });
});
