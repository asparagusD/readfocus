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
  focus_this_week: { seconds: 4200, points: 1540, sessions: 2 }, // C23.7c
  score_over_time: Array.from({ length: 10 }, (_, i) => ({ date: day(30 - i * 3), score_pct: 50 + i * 2.5, book_id: 'walden', book_title: 'Walden' })),
  book_progress: [
    { book_id: 'walden', title: 'Walden', author: 'Henry David Thoreau', total_chunks: 10, chunks_completed: 6, progress_pct: 60, avg_score: 72, sessions_completed: 6, est_sessions_to_finish: 3 },
    { book_id: 'middlemarch', title: 'Middlemarch', author: 'George Eliot', total_chunks: 40, chunks_completed: 0, progress_pct: 0, avg_score: 0, sessions_completed: 0, est_sessions_to_finish: 0 },
  ],
  recent_feedback: [
    { feedback: 'You named simplicity but missed quiet desperation. See the passage: “The mass of men lead lives of quiet desperation.”', score: 4, max_score: 10, book_title: 'Walden', date: day(1) },
  ],
};

/** Walden has 13 concepts (weakest first, the API's order); Middlemarch none yet. */
const CONCEPTS = Array.from({ length: 13 }, (_, i) => ({
  book_id: 'walden', concept_key: `c${i}`, label: i === 0 ? 'quiet desperation' : `concept ${i}`,
  mastery: 0.2 + i * 0.05, attempts: i === 12 ? 0 : 2, correct: 1, last_seen: null, next_review: null,
}));

export async function mockDashboard(page, body = DASHBOARD, { status = 200, mastery = 200 } = {}) {
  const calls = [];
  await page.route('http://localhost:8000/dashboard', (route) => json(route, status === 200 ? body : { detail: 'down' }, status));
  await page.route(/localhost:8000\/mastery\?/, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') calls.push(url.search);
    if (mastery !== 200) return json(route, { detail: 'down' }, mastery);
    const rows = url.searchParams.get('book_id') === 'walden' ? CONCEPTS : [];
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    return json(route, { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset });
  });
  return calls;
}

test('C23.7c: focused time and points this week, from the server', async ({ page }) => {
  await mockDashboard(page);
  await page.goto('/dashboard');
  const card = page.getByRole('region', { name: 'Focus this week' });
  await expect(card).toContainText('1 h 10 min');
  await expect(card).toContainText('focused');
  await expect(card).toContainText('1,540');
  await expect(card).toContainText('points');
  await expect(card).toContainText('From 2 focus sessions since Monday.');
  if (shots) await page.screenshot({ path: `${shots}/dashboard-focus-1440.png`, fullPage: true });
});

// C35.1 (issue 21): the Badge shelf sits in the main column under Concept mastery, so the main column never ends
// long before the side one at 1440 px (it was 1,111 px of empty column); the shelf keeps its own layout after the
// Library's styles have loaded in the same visit.
test('at 1440 px the badge shelf is under concept mastery and the main column does not end early', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboard(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Dashboard' }).click(); // in the app, so the Library's styles stay loaded
  const shelf = page.getByRole('region', { name: 'Badge shelf' });
  await expect(shelf.getByRole('listitem')).toHaveCount(14);
  await expect(page.locator('.rf-dash__main').getByRole('region', { name: 'Badge shelf' })).toHaveCount(1);
  const mastery = await page.getByRole('region', { name: 'Concept mastery' }).boundingBox();
  const shelfBox = await shelf.boundingBox();
  expect(shelfBox.y).toBeGreaterThan(mastery.y + mastery.height - 1);
  expect(await shelf.evaluate((el) => getComputedStyle(el).display)).toBe('block');
  if (shots) await page.screenshot({ path: `${shots}/dashboard-layout-1440.png`, fullPage: true });
  const main = await page.locator('.rf-dash__main').boundingBox();
  const side = await page.locator('.rf-dash__side').boundingBox();
  expect(main.y + main.height).toBeGreaterThanOrEqual(side.y + side.height - 200);
});

for (const width of [375, 967]) {
  test(`at ${width} px the badge shelf stays last, after the side cards (C35.1)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockDashboard(page);
    await page.goto('/dashboard');
    const shelf = page.getByRole('region', { name: 'Badge shelf' });
    await expect(shelf.getByRole('listitem')).toHaveCount(14);
    const feedback = await page.getByRole('region', { name: 'Recent feedback' }).boundingBox();
    expect((await shelf.boundingBox()).y).toBeGreaterThan(feedback.y + feedback.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('C23.7c: with no focus yet the card says how to start, at 375 too', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockDashboard(page, { ...DASHBOARD, focus_this_week: { seconds: 0, points: 0, sessions: 0 } });
  await page.goto('/dashboard');
  const card = page.getByRole('region', { name: 'Focus this week' });
  await expect(card).toContainText('0 min');
  await expect(card).toContainText('Turn on Focus mode in a book and your focused time and points gather here.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  if (shots) await page.screenshot({ path: `${shots}/dashboard-focus-375.png`, fullPage: true });
});

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
  await expect(books).toContainText('60% read · 6 quizzes'); // C32.3: no sessions, no estimate to finish
  await expect(books).not.toContainText('to finish');
  await expect(books).not.toContainText('session');
  await expect(page.getByRole('region', { name: 'Recent feedback' }).locator('blockquote')).toHaveText('“The mass of men lead lives of quiet desperation.”');
  if (shots) await page.screenshot({ path: `${shots}/dashboard-1440.png`, fullPage: true });
});

test('a new reader sees a way to start, not empty charts', async ({ page }) => {
  await page.goto('/dashboard'); // the fixtures' empty dashboard
  await expect(page.getByRole('heading', { name: 'Your progress starts with your first page' })).toBeVisible();
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

test('concept mastery: a tab per book, weakest first, ten at a time, words for the weak ones', async ({ page }) => {
  const calls = await mockDashboard(page);
  await page.goto('/dashboard');
  const tabs = page.getByRole('tablist', { name: 'Books' });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  const panel = page.getByRole('tabpanel', { name: 'Walden' });
  const rows = panel.getByRole('listitem');
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText('quiet desperation');
  await expect(rows.first()).toContainText('Needs revisiting');
  await expect(rows.first()).toContainText('20%');
  await expect(rows.nth(6)).not.toContainText('Needs revisiting'); // 0.5 is not weak
  await panel.getByRole('button', { name: 'Show more (3 left)' }).click();
  await expect(rows).toHaveCount(13);
  await expect(rows.last()).not.toContainText('Needs revisiting'); // untested: only the prior
  await expect(panel.getByRole('button', { name: /Show more/ })).toHaveCount(0);
  await tabs.getByRole('tab', { name: 'Walden' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Middlemarch' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Middlemarch' })).toContainText('No concepts yet for this book.');
  await page.keyboard.press('ArrowLeft');
  await expect(rows).toHaveCount(13); // kept, not fetched again
  expect(calls).toEqual(['?book_id=walden&limit=10&offset=0', '?book_id=walden&limit=10&offset=10', '?book_id=middlemarch&limit=10&offset=0']);
  if (shots) await page.screenshot({ path: `${shots}/dashboard-mastery-1440.png`, fullPage: true });
});

// C33 (issues 8-10): titles taken from file names, as on a real shelf.
const LONG = [
  'Hands On Graph Neural Networks Using Python Practical Maxime Labonne 1, 2023 Packt Publishing Pvt Ltd Isbn13 9781804610701 79b8dc49d8162f3e6d22a51777fe0aa5 Anna’S Archive',
  'Accelerated Computing With HIP Yifan Sun, Trinayan Baruah, David R Kaeli La Vergne, 2022 Sun, Baruah And Kaeli 9798218107444 4',
  'Methodology', 'AWPL Naufel', 'Machine Learning With PyTorch And Scikit Learn',
  'Cracking The Coding Interview 6th Edition 189 Programming Questions And Solutions',
  'David Harris Sarah Harris Digital Design And Computer Architecture EN',
];
const LONG_SHELF = { ...DASHBOARD, book_progress: LONG.map((title, i) => ({ ...DASHBOARD.book_progress[1], book_id: `long-${i}`, title })) };

for (const width of [375, 1440]) {
  test(`long book titles never widen the page or run under the side column at ${width} px (C33)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockDashboard(page, LONG_SHELF);
    await page.goto('/dashboard');
    const tabs = page.getByRole('tablist', { name: 'Books' });
    await expect(tabs.getByRole('tab')).toHaveCount(LONG.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // Under 1024 px the main column is display: contents (C35.1), so measure against its Concept mastery section.
    const main = await page.getByRole('region', { name: 'Concept mastery' }).boundingBox();
    const list = await tabs.boundingBox();
    expect(list.x + list.width).toBeLessThanOrEqual(main.x + main.width + 1); // the row stays inside the main column
    // C35.1 (issue 21): one row that scrolls sideways, never wrapping onto a second line.
    const tops = await tabs.getByRole('tab').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const last = tabs.getByRole('tab').last();
    await tabs.getByRole('tab').first().focus();
    await page.keyboard.press('End'); // keyboard focus, so the ring shows
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport(); // a tab past the edge scrolls into view when it takes focus
    if (shots) await tabs.screenshot({ path: `${shots}/dashboard-tabs-focus-${width}.png` });
    await expect(tabs.getByRole('tab', { name: LONG[0] })).toHaveAttribute('title', LONG[0]); // the full title
    const title = await page.locator('.rf-dash__book-title').first().evaluate((el) =>
      ({ height: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize) }));
    expect(title.height).toBeLessThanOrEqual(title.font * 1.6 * 2 + 1); // two lines at most
    if (shots) await page.screenshot({ path: `${shots}/dashboard-long-titles-${width}.png`, fullPage: true });
  });
}

test('a failed mastery load says so in its panel and can try again', async ({ page }) => {
  await mockDashboard(page, DASHBOARD, { mastery: 503 });
  await page.goto('/dashboard');
  const panel = page.getByRole('tabpanel', { name: 'Walden' });
  await expect(panel.getByRole('alert')).toContainText('This book’s concepts didn’t load.');
  await page.unroute(/localhost:8000\/mastery\?/);
  await page.route(/localhost:8000\/mastery\?/, (route) => json(route, { items: [], total: 0, limit: 10, offset: 0 }));
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel).toContainText('No concepts yet for this book.');
});

test('continue reading: the started book with the most read, and its way in', async ({ page }) => {
  await mockDashboard(page);
  await page.goto('/dashboard');
  const card = page.getByRole('region', { name: 'Continue reading' });
  await expect(card).toContainText('Walden');
  await expect(card).toContainText('60% read. It opens where you left off.');
  await expect(card.getByRole('link', { name: 'Begin reading' })).toHaveAttribute('href', '/read/walden');
});

for (const reduced of [false, true]) {
  test(`dashboard motion ${reduced ? 'is off under reduced motion' : 'draws, grows and flickers briefly'}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await mockDashboard(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('tabpanel', { name: 'Walden' }).getByRole('listitem')).toHaveCount(10);
    const flame = await page.locator('.rf-dash__candle [data-part="flame"]').evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.animationName, s.animationDuration, s.animationIterationCount];
    });
    const grow = await page.locator('.rf-mastery-list__bar .rf-mastery__fill').first().evaluate((el) => getComputedStyle(el).animationDuration);
    const drawn = await page.locator('.rf-trend .recharts-area-curve').getAttribute('stroke-dasharray');
    if (reduced) {
      expect(flame).toEqual(['rf-candle-flicker', '1e-05s', '1']);
      expect(grow).toBe('1e-05s');
      expect(drawn).toBeNull(); // Recharts draws nothing in
    } else {
      expect(flame).toEqual(['rf-candle-flicker', '2.4s', '2']); // 4.8 s in all, then still
      expect(grow).toBe('0.8s');
    }
  });
}
