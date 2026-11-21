// C23.6a: focus mode. The toolbar's Focus switch puts the focus bar in its place: a padlock before the book's
// body start, then Start, a stopwatch from the server's time, heartbeats every 30 s while visible, page turns,
// hidden and visible, pause and resume, "Still with the book?" after ten quiet minutes, the 2 h 45 notice, the
// 3-hour stop, and leaving with a session open (end or discard). Mocked API; the page's clock is Playwright's.
// The end flow (ribbon, ready, quiz) is focus-end.spec.js (C23.6b).
import { book, clickTool, expect, openReader, settled, test } from './fixtures';

const bar = (page) => page.getByRole('region', { name: 'Focus mode' });
const kinds = (api) => api.focus.events.map((e) => e.kind);
const calls = (api, end) => api.focus.calls.filter((c) => c.method === 'POST' && c.path.endsWith(end));
const start = (page) => ({ source: 'outline', body_start: { kind: 'pdf', page, title: 'Chapter 1',
  anchor: { kind: 'pdf', page, quads: [[0, 0, 0, 0]], text: '' } } });

async function focusOn(page) {
  await clickTool(page, page.getByRole('switch', { name: 'Focus mode' })); // C38.4b: in More tools on a phone
  await expect(bar(page)).toBeVisible();
}

async function hide(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.beforeEach(async ({ page }) => { await page.clock.install(); });

test('before the body start the stopwatch is locked and says why', async ({ page, api }) => {
  api.bodyStart = start(6);
  await openReader(page);
  await focusOn(page);
  await expect(page.getByRole('toolbar', { name: 'Reading controls' })).toHaveCount(0);
  const lock = bar(page).getByRole('button', { name: 'Unlocks at Chapter 1' });
  await expect(lock).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Start' })).toHaveCount(0);
  await lock.click();
  await expect(page.getByRole('note')).toContainText('The clock starts at Chapter 1.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(lock).toBeFocused();
  expect(calls(api, '/focus/start')).toEqual([]);
});

test('the notebook and Steve open in focus mode, and the clock runs on (C31.1, C37.3)', async ({ page, api }) => {
  api.bodyStart = start(1);
  await openReader(page);
  await focusOn(page);
  await expect(bar(page)).toContainText('Focus · badges are tucked away');
  await bar(page).getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => calls(api, '/focus/start').length).toBe(1);
  const notes = bar(page).getByRole('button', { name: 'Notes' });
  await notes.click(); // C37.3: the notebook, the clock still running behind it
  const notebook = page.getByRole('dialog', { name: 'Notebook' });
  await expect(notebook).toBeVisible();
  await expect(notes).toHaveAttribute('aria-expanded', 'true');
  api.focus.active = 30;
  await page.clock.runFor(30_000);
  await expect(bar(page).getByRole('timer')).toHaveText('00:30');
  await notebook.getByRole('button', { name: 'Close notebook' }).click();
  await expect(notes).toBeFocused(); // focus goes back to the button that opened it, as on the toolbar
  await expect(bar(page).getByRole('button', { name: 'Pause focus' })).toBeVisible();
  const steve = bar(page).getByRole('button', { name: 'Ask Steve' });
  await steve.click();
  await expect(page.getByRole('complementary', { name: /Steve/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close Steve' }).click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(steve).toBeFocused();
  expect(calls(api, '/focus/pause')).toEqual([]);
});

test('while a session waits for its quiz, Steve is not offered; Notes still is (C31.1)', async ({ page, api }) => {
  api.bodyStart = start(1);
  api.focus.session = { id: 'focus-1', book_id: 'e2e-book', status: 'awaiting_quiz', state: 'awaiting_quiz', reasons: {} };
  await openReader(page);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Notes' })).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Ask Steve' })).toHaveCount(0);
});

test('after it: Start, a heartbeat at once and every 30 s, page turns, and the time running on', async ({ page, api }) => {
  api.bodyStart = start(1);
  await openReader(page);
  await focusOn(page);
  await bar(page).getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => calls(api, '/focus/start').length).toBe(1);
  await expect(bar(page).getByRole('timer')).toHaveText('00:00');
  const [started] = calls(api, '/focus/start');
  expect(started.body.anchor.kind).toBe('pdf');
  expect(started.body.book_id).toBe('e2e-book');
  await expect.poll(() => kinds(api)).toEqual(['heartbeat']);
  api.focus.active = 30; // what the server counts by the next heartbeat
  await page.clock.runFor(30_000);
  await expect.poll(() => kinds(api)).toEqual(['heartbeat', 'heartbeat']);
  await expect(bar(page).getByRole('timer')).toHaveText('00:30');
  expect(api.focus.events.every((e) => e.client_event_id && e.client_ts)).toBe(true);
  const before = await settled(page);
  await book(page).focus();
  await page.keyboard.press('ArrowRight');
  await settled(page, before);
  await expect.poll(() => api.focus.events.filter((e) => e.kind === 'page_turn').length).toBe(1);
  expect(api.focus.events.find((e) => e.kind === 'page_turn').page_key).toMatch(/^p\d+$/);
  api.focus.active = 3725; // the server's minute read sets the display
  await page.clock.runFor(60_000);
  await expect(bar(page).getByRole('timer')).toHaveText(/^1:0[23]$/);
  await expect(bar(page).getByRole('timer')).toHaveAttribute('aria-label', /Focus time: 1 hour [23] minutes/);
});

test('a hidden tab pauses; visible again resumes with a heartbeat', async ({ page, api }) => {
  api.bodyStart = start(1);
  await openReader(page);
  await focusOn(page);
  await bar(page).getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => kinds(api)).toEqual(['heartbeat']);
  await hide(page, true);
  await expect.poll(() => kinds(api)).toEqual(['heartbeat', 'hidden']);
  await expect(bar(page)).toContainText('Paused while away');
  await page.clock.runFor(60_000);
  expect(kinds(api)).toEqual(['heartbeat', 'hidden']); // no heartbeat while hidden
  await hide(page, false);
  await expect.poll(() => kinds(api)).toEqual(['heartbeat', 'hidden', 'visible', 'heartbeat']);
});

test('pause and resume', async ({ page, api }) => {
  api.bodyStart = start(1);
  await openReader(page);
  await focusOn(page);
  await bar(page).getByRole('button', { name: 'Start' }).click();
  await bar(page).getByRole('button', { name: 'Pause focus' }).click();
  await expect(bar(page)).toContainText('Paused');
  await bar(page).getByRole('button', { name: 'Resume' }).click();
  await expect(bar(page).getByRole('button', { name: 'Pause focus' })).toBeVisible();
  await expect.poll(() => api.focus.calls.filter((c) => c.method === 'POST').map((c) => c.path.split('/').pop()))
    .toEqual(['start', 'event', 'pause', 'resume', 'event']);
});

test('"Still with the book?" after ten quiet minutes, answered or resting', async ({ page, api }) => {
  api.bodyStart = start(1);
  await openReader(page);
  await focusOn(page);
  await bar(page).getByRole('button', { name: 'Start' }).click();
  await page.mouse.move(5, 5);
  await page.clock.runFor(10 * 60_000 + 6_000);
  const prompt = page.getByRole('group', { name: 'Still with the book?' });
  await expect(prompt).toBeVisible();
  await expect.poll(() => kinds(api).filter((k) => k === 'idle_prompt').length).toBe(1);
  await page.clock.runFor(61_000);
  await expect(prompt).toContainText('resting until you');
  await prompt.getByRole('button', { name: 'I’m here' }).click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => kinds(api).filter((k) => k === 'idle_confirm').length).toBe(1);
});

test('the 2 h 45 notice, and the 3-hour stop asking for the bookmark', async ({ page, api }) => {
  api.bodyStart = start(1);
  await openReader(page);
  await focusOn(page);
  await bar(page).getByRole('button', { name: 'Start' }).click();
  api.focus.active = 9905;
  await page.clock.runFor(60_000);
  const notice = page.getByRole('group', { name: '15 minutes left in this focus session' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(notice).toHaveCount(0);
  api.focus.active = 10800;
  api.focus.session.status = 'awaiting_quiz';
  await page.clock.runFor(60_000);
  await expect(page.getByRole('group', { name: 'Three hours of focus' })).toBeVisible();
  await expect(bar(page).getByRole('timer')).toHaveText('3:00');
});

test('leaving with a session open asks; discard ends it with nothing scored', async ({ page, api }) => {
  api.bodyStart = start(1);
  await openReader(page);
  await focusOn(page);
  await bar(page).getByRole('button', { name: 'Exit focus mode' }).click(); // nothing started: just leaves
  await expect(bar(page)).toHaveCount(0);
  await focusOn(page);
  await bar(page).getByRole('button', { name: 'Start' }).click();
  await bar(page).getByRole('button', { name: 'Exit focus mode' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave focus mode?' });
  await dialog.getByRole('button', { name: 'Keep focusing' }).click();
  await expect(bar(page)).toBeVisible();
  await bar(page).getByRole('button', { name: 'Exit focus mode' }).click();
  await dialog.getByRole('button', { name: 'Discard session' }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Reading controls' })).toBeVisible();
  expect(calls(api, '/discard')).toHaveLength(1);
  await expect(page.getByText('Focus session discarded. Nothing was scored.')).toBeVisible();
});

test('a reload finds the open session and stays in focus mode', async ({ page, api }) => {
  api.focus.session = { id: 'focus-1', book_id: 'e2e-book', status: 'active', state: 'running', reasons: {},
    points_time: 0, points_total: 0, ignored_events: 0 };
  api.focus.active = 754;
  await openReader(page);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByRole('timer')).toHaveText('12:34');
});

test.describe('phone, Lamplight, reduced motion', () => {
  test.use({ viewport: { width: 375, height: 812 }, colorScheme: 'dark', reducedMotion: 'reduce' });

  test('the bar fits, every control is 44 px, the dot is still', async ({ page, api }) => {
    api.bodyStart = start(1);
    await openReader(page);
    await focusOn(page);
    await bar(page).getByRole('button', { name: 'Start' }).click();
    await expect(bar(page).getByRole('timer')).toBeVisible();
    for (const button of await bar(page).getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('.rf-focus-dot').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
});
