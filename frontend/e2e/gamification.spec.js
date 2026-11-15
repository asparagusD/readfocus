// Gamification end to end (C24.7): two readers on Playwright's fake clock, shown what the server really answers.
// The answers come from backend/tests/test_gamification_journey.py, which runs the real XP, streak, badge, rollover
// and league code for readers A and B and keeps every answer in e2e/fixtures/gamification-journey.json (that test
// fails when the file is stale). Here each step opens the app at the step's moment and checks what the reader sees:
// XP added once, the goal moving the streak, a freeze keeping it over a missed day, each badge once, the promotion
// on the League page, and B's opt-out taking B off A's board.
import { readFileSync } from 'node:fs';
import { test, expect, mockBackend, signIn } from './fixtures.js';

const JOURNEY = JSON.parse(readFileSync(new URL('./fixtures/gamification-journey.json', import.meta.url), 'utf8'));
const step = (name, reader = 'A') => JOURNEY.find((s) => s.step === name && s.reader === reader);
const earnedOf = (shelf) => Object.fromEntries(shelf.badges.filter((b) => b.earned).map((b) => [b.id, b.awarded_at]));
const header = (page) => page.getByRole('link', { name: /^Level \d+/ });
const group = (page) => page.getByRole('region', { name: 'Your group this week' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const DASHBOARD = { reading_streak: 0, words_this_week: 0, focus_this_week: { seconds: 0, points: 0, sessions: 0 },
  score_over_time: [], recent_feedback: [], book_progress: [{ book_id: 'walden', title: 'Walden', author: 'Henry David Thoreau',
    total_chunks: 10, chunks_completed: 3, progress_pct: 30, avg_score: 70, sessions_completed: 3, est_sessions_to_finish: 7 }] };
/** Answer one API route with JSON from `body()` (registered after the fixtures' routes, so it wins). */
const answer = (page, url, body) => page.route(url, (route) => route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 204, headers: CORS })
  : route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body()) }));

test.use({ timezoneId: 'Europe/London' }); // the readers' zone in the journey, so the device's zone is not re-saved

/** Open `path` as this page's reader at a step's moment; the stored sign-in is kept fresh past the fake date. */
async function openAt(page, name, path, reader = 'A') {
  await page.clock.install({ time: new Date(step(name, reader).at) });
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k))) {
      const session = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ ...session, expires_at: 4102444800 })); // 2100
    }
  });
  await page.goto(path);
}

test('a focus session’s XP is added once and the goal lights the streak', async ({ page, api }) => {
  api.progress = step('xp-once').body;
  await openAt(page, 'xp-once', '/');
  const name = 'Level 1, 80 of 250 XP to level 2. Today\'s goal is met, 60 XP. 1 day in a row. Open your progress.';
  await expect(header(page)).toHaveAccessibleName(name);
  await page.reload(); // reading again adds nothing
  await expect(header(page)).toHaveAccessibleName(name);
  expect(api.progressPuts).toEqual([]);

  api.progress = step('goal-streak').body;
  await page.clock.setSystemTime(new Date(step('goal-streak').at));
  await page.reload();
  await expect(header(page)).toHaveAccessibleName(/Today's goal is met, 60 XP\. 2 days in a row\./);
});

test('seven goal days earn a freeze, and a missed day is covered by it', async ({ page, api }) => {
  api.progress = step('streak-7').body;
  await openAt(page, 'streak-7', '/');
  await expect(header(page)).toHaveAccessibleName(/7 days in a row, 1 freeze saved\./);
  await expect(header(page).locator('.rf-hp__drop.is-held')).toHaveCount(1);

  api.progress = step('frozen').body; // Tuesday morning, Monday missed: the streak stands, the freeze is spent
  await page.clock.setSystemTime(new Date(step('frozen').at));
  await page.reload();
  await expect(header(page)).toHaveAccessibleName(/Today 0 of 50 XP\. 7 days in a row\. Open/);
  await expect(header(page).locator('.rf-hp__drop.is-held')).toHaveCount(0);

  api.progress = step('streak-kept').body;
  await page.clock.setSystemTime(new Date(step('streak-kept').at));
  await page.reload();
  await expect(header(page)).toHaveAccessibleName(/Today's goal is met, 60 XP\. 8 days in a row\./);
});

test('each badge is on the shelf once', async ({ page, api }) => {
  api.badgesEarned = earnedOf(step('badges').body);
  await answer(page, 'http://localhost:8000/mastery?**', () => ({ items: [], total: 0, limit: 10, offset: 0 }));
  await answer(page, 'http://localhost:8000/dashboard', () => DASHBOARD); // a reader with a book: the shelf shows
  await openAt(page, 'badges', '/dashboard');
  const shelf = page.getByRole('region', { name: 'Badge shelf' });
  await expect(shelf).toContainText('2 of 14 earned');
  const earned = shelf.locator('.rf-badge.is-earned');
  await expect(earned).toHaveCount(2);
  await expect(earned.filter({ hasText: 'First focus session' })).toContainText('Earned 12 Nov 2026');
  await expect(earned.filter({ hasText: '7-day streak' })).toContainText('Earned 22 Nov 2026');
});

test('B opts out and leaves A’s board; B still sees their own place', async ({ page, api, browser }) => {
  api.league = step('board').body;
  await openAt(page, 'board', '/league');
  await expect(group(page).locator('.rf-standing')).toHaveCount(3);
  await expect(group(page)).toContainText('Marginalia');

  const other = await browser.newContext({ timezoneId: 'Europe/London' });
  const pageB = await other.newPage();
  const apiB = { unmocked: [], progress: step('b-progress', 'B').body, progressReads: 0, progressPuts: [],
    league: step('b-board', 'B').body, badgesEarned: {}, focus: { session: null, active: 0, calls: [], events: [] } };
  await mockBackend(pageB, apiB, 'pdf');
  await answer(pageB, 'http://localhost:8000/leagues/current',
    () => step(apiB.progressPuts.length ? 'b-own-board' : 'b-board', 'B').body);
  await signIn(pageB);
  await openAt(pageB, 'b-board', '/league', 'B');
  await expect(group(pageB).locator('[aria-current="true"]')).toContainText('Marginalia (you)');
  const settings = pageB.getByRole('region', { name: 'Your league settings' });
  await settings.getByLabel('Keep me off other readers’ boards').check();
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(() => apiB.progressPuts).toEqual([{ leaderboard_opt_out: true }]);
  await expect(pageB.getByText('You keep yourself off other readers’ boards; only you see your place here.')).toBeVisible();
  await expect(group(pageB).locator('[aria-current="true"]')).toContainText('Marginalia (you)');
  expect(apiB.unmocked).toEqual([]);
  await other.close();

  api.league = step('b-opted-out').body;
  await page.reload();
  await expect(group(page).locator('.rf-standing')).toHaveCount(2);
  await expect(group(page).locator('.rf-standing__gap')).toHaveCount(1); // rank 2 keeps off A's board
  await expect(group(page)).not.toContainText('Marginalia');
});

test('the Monday rollover’s promotion shows on the League page', async ({ page, api }) => {
  api.league = step('promoted').body;
  await openAt(page, 'promoted', '/league');
  await expect(page.getByRole('heading', { level: 1, name: 'Paperback league' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Last week' }))
    .toContainText('Last week you came 1st of 3 with 470 XP and moved up to Paperback.');
  await expect(group(page).locator('[aria-current="true"]')).toContainText('Quiet Owl (you)');
});
