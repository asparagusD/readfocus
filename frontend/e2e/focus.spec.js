// C23.8: focus mode end to end with Playwright's fake clock, on the mocked API. What the tab sends is checked
// here (heartbeats, page turns, hidden and visible, the bookmark) and what the results show for the server's
// answer; the numbers themselves come from the real engine in backend/tests/test_focus_anticheat.py
// (the 31-minute stall voids one minute, under 40% earns 0, 80% earns time and bonus).
import { book, clickTool, expect, mockBackend, openReader, settled, signIn, test } from './fixtures';

const bar = (page) => page.getByRole('region', { name: 'Focus mode' });
const kinds = (api) => api.focus.events.map((e) => e.kind);
const chapter1 = { source: 'outline', body_start: { kind: 'pdf', page: 3, title: 'Chapter 1',
  anchor: { kind: 'pdf', page: 3, quads: [[0, 0, 0, 0]], text: '' } } };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const reply = (route, body) => (route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 204, headers: CORS })
  : route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

/** Five multiple-choice questions, as the server would build for about 2,000 words; the answer is option (b). */
const QUIZ = Array.from({ length: 5 }, (_, i) => ({
  question: `Question ${i + 1} about the lamp?\n(a) A shadow  (b) A small circle of light`, type: 'factual',
  options: ['A shadow', 'A small circle of light'] }));
const RIGHT = '(b) A small circle of light';

/** The server's quiz and grading for focus-1: 5 questions; the grade answers as the engine does for that many right. */
async function serveQuiz(page, api) {
  await page.route('http://localhost:8000/focus/focus-1/quiz', (route) => reply(route, { questions: QUIZ, count: 5, words_in_range: 2000 }));
  await page.route('http://localhost:8000/sessions/focus-1', (route) => reply(route, { id: 'focus-1', book_id: 'e2e-book', status: 'testing', test_questions: QUIZ }));
  await page.route('http://localhost:8000/focus/focus-1/quiz/answers', (route) => {
    if (route.request().method() === 'OPTIONS') return reply(route, {});
    const answers = JSON.parse(route.request().postData()).answers;
    api.focus.answers = answers;
    const right = answers.filter((a) => a === RIGHT).length;
    const passed = right / 5 >= 0.4;
    const time = Math.floor(api.focus.counted / 6);
    const lines = [{ code: 'counted', label: 'Focused reading', seconds: api.focus.counted, points: time },
      ...(api.focus.voided ? [{ code: 'page_cap', label: 'Time on one page beyond 30 minutes without moving to another page', seconds: api.focus.voided, points: 0 }] : []),
      { code: 'quiz_bonus', label: `Quiz: ${right} of 5 correct`, points: passed ? right * 20 : 0 }];
    return reply(route, { id: 'focus-1', status: 'scored', passed, quiz_correct: right, quiz_total: 5,
      points_time: passed ? time : 0, points_bonus: passed ? right * 20 : 0, points_total: passed ? time + right * 20 : 0,
      total_score: right * 10, max_score: 50, percentage: right * 20, lines,
      per_question: answers.map((a) => ({ score: a === RIGHT ? 10 : 0, max_score: 10, feedback: a === RIGHT ? 'Right.' : 'Not this time.', confidence: 'high' })) });
  });
}

async function hide(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function toChapter1(page) { // C38.2: a page at a time, from the preface (p. 1) to chapter 1 (p. 3)
  let before = await settled(page);
  await book(page).focus();
  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press('ArrowRight');
    before = await settled(page, before);
  }
  return before;
}

async function startAtChapter1(page, api) {
  api.bodyStart = chapter1;
  await openReader(page);
  await clickTool(page, page.getByRole('switch', { name: 'Focus mode' }));
  await expect(bar(page).getByRole('button', { name: 'Unlocks at Chapter 1' })).toBeVisible(); // the preface is locked
  await toChapter1(page);
  await bar(page).getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => kinds(api)).toEqual(['heartbeat']);
  expect(api.focus.calls.find((c) => c.path === '/focus/start').body.anchor.page).toBeGreaterThanOrEqual(3);
}

/**
 * Another tab on the same fake server: in this browser context (sharing its storage and its fake clock), or,
 * with `fresh`, in a new context on the real clock (the quiz's slides need time to pass).
 */
async function anotherTab(page, api, { fresh = false } = {}) {
  const context = fresh ? await page.context().browser().newContext() : page.context();
  const tab = await context.newPage();
  await mockBackend(tab, api, 'pdf');
  await signIn(tab);
  await tab.setViewportSize({ width: 1440, height: 900 });
  return tab;
}

/**
 * End session, set the ribbon on the last page shown, see "Ready for your questions?", then take the quiz in a
 * tab on the real clock (the reading needed the fake one; the questions' slides need time to pass) and answer
 * `right` of 5. Returns that tab, on the results.
 */
async function endAndAnswer(page, api, right) {
  await bar(page).getByRole('button', { name: 'End session' }).click();
  // The last page shown: the spread's first is front matter, before the session's start (the server refuses it).
  await page.getByRole('group', { name: 'Place the ribbon' }).getByRole('button', { name: /^Set ribbon on p\./ }).last().click();
  const ready = page.getByRole('dialog', { name: 'Ready for your questions?' });
  await expect(ready).toContainText('Five short questions on what you read, about 6 minutes.');
  await expect(ready).toContainText('Get 2 of 5 right to keep them.');
  expect(api.focus.session.end_anchor.page).toBeGreaterThanOrEqual(3); // never before the session's start
  const quiz = await anotherTab(page, api, { fresh: true });
  await serveQuiz(quiz, api);
  await quiz.goto('/focus/focus-1/quiz');
  // A cold new context (app shell, sign-in restore, the lazy quiz page, the quiz request) can take longer than a
  // page already open, under the full suite's load (DEBUG_LOG 2026-11-15, C23.G); then each question as usual.
  await expect(quiz.getByText(/^Question 1 of 5/)).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 5; i += 1) {
    await expect(quiz.getByText(new RegExp(`^Question ${i + 1} of 5`))).toBeVisible();
    await quiz.getByRole('radio', { name: i < right ? /A small circle of light/ : /A shadow/ }).click();
    if (i < 4) await quiz.locator('[data-test-next]').click();
  }
  await quiz.getByRole('button', { name: 'Submit answers' }).click();
  await expect(quiz).toHaveURL(/\/results\/focus-1$/);
  return quiz;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
});

test('locked before chapter 1; then start, beats, a page turn, a hidden tab, the bookmark and 80%: time and bonus',
  async ({ page, api }) => {
    await serveQuiz(page, api);
    await startAtChapter1(page, api);
    await page.clock.runFor(60_000);
    await expect.poll(() => kinds(api)).toEqual(['heartbeat', 'heartbeat', 'heartbeat']);
    await toChapter1(page); // the next spread
    await expect.poll(() => kinds(api).at(-1)).toBe('page_turn');
    await hide(page, true);
    await expect.poll(() => kinds(api).at(-1)).toBe('hidden');
    const whileHidden = kinds(api).length;
    await page.clock.runFor(120_000);
    expect(kinds(api).length).toBe(whileHidden); // no heartbeats from a hidden tab: the server pauses the clock
    await hide(page, false);
    await expect.poll(() => kinds(api).slice(whileHidden)).toEqual(['visible', 'heartbeat']);
    api.focus.active = api.focus.counted = 600;
    const results = await endAndAnswer(page, api, 4); // 4 of 5 is 80%
    expect(api.focus.answers.filter((a) => a === RIGHT)).toHaveLength(4);
    const rows = results.getByRole('region', { name: 'How this session scored' }).locator('.rf-points__row');
    await expect(rows.nth(0)).toContainText('10 minutes');
    await expect(rows.nth(0).locator('dd')).toHaveText('+100');
    await expect(rows.nth(1)).toContainText('4 of 5 right · 80%');
    await expect(rows.nth(1).locator('dd')).toHaveText('+80');
    await expect(rows.last().locator('dd')).toHaveText('+180');
  });

test('a 31-minute stall on one page: beats all along with no turn; the extra minute is listed as not counted',
  async ({ page, api }) => {
    await serveQuiz(page, api);
    await startAtChapter1(page, api);
    for (let minute = 0; minute < 31; minute += 1) {
      await page.mouse.wheel(0, 1); // reading: input now and then, so no "Still with the book?"
      await page.clock.runFor(60_000);
    }
    await expect.poll(() => kinds(api).filter((k) => k === 'heartbeat').length).toBeGreaterThanOrEqual(62);
    expect(kinds(api)).not.toContain('page_turn');
    expect(kinds(api)).not.toContain('idle_prompt');
    expect(api.focus.events.filter((e) => e.kind === 'heartbeat').some((e) => e.had_input)).toBe(true);
    api.focus.active = 31 * 60;
    api.focus.counted = 30 * 60; // the engine's answer for one 31-minute visit (test_focus_anticheat.py)
    api.focus.voided = 60;
    const results = await endAndAnswer(page, api, 5);
    const rows = results.getByRole('region', { name: 'How this session scored' }).locator('.rf-points__row');
    await expect(rows.nth(0)).toContainText('30 minutes');
    await expect(rows.nth(0).locator('dd')).toHaveText('+300');
    await expect(rows.nth(1)).toContainText('Not counted');
    await expect(rows.nth(1)).toContainText('· 1 minute');
  });

// C38.8 (issue 22, D3): F7 counts on the page most in view: a scroll within it is no page turn; a scroll that leaves
// the next page most in view is one, keyed by that page.
test('a scroll within the page most in view is no page turn; one that leaves the next page most in view is', async ({ page, api }) => {
  await startAtChapter1(page, api);
  const area = await page.locator('.rf-pdf-book').boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  const top = () => page.locator('.rf-pdf-book').evaluate((el) => el.scrollTop);
  const before = await top();
  await page.mouse.wheel(0, 160); // page 3 still most in view
  await page.clock.runFor(1000);
  await expect.poll(top).toBeGreaterThan(before + 100);
  await page.clock.runFor(1000);
  expect(kinds(api)).not.toContain('page_turn');
  await page.mouse.wheel(0, 560); // now page 4 has most of the view
  await page.clock.runFor(1000);
  await expect.poll(() => api.focus.events.filter((e) => e.kind === 'page_turn').map((e) => e.page_key)).toEqual(['p4']);
});

test('under 40% (1 of 5): no points, said kindly', async ({ page, api }) => {
  await serveQuiz(page, api);
  await startAtChapter1(page, api);
  await page.clock.runFor(5 * 60_000);
  api.focus.active = api.focus.counted = 300;
  const results = await endAndAnswer(page, api, 1);
  await expect(results.getByRole('note')).toHaveText(/No points this time; you got 1 of 5\. Points return when you score 40% or more\./);
  const rows = results.getByRole('region', { name: 'How this session scored' }).locator('.rf-points__row');
  await expect(rows.last().locator('dd')).toHaveText('0');
});

test('two tabs on one session: the second only shows the time, and takes over once the first has gone',
  async ({ page, api }) => {
    await startAtChapter1(page, api);
    const second = await anotherTab(page, api); // the context's fake clock covers it too
    await openReader(second);
    await expect(bar(second)).toContainText('Focus is running in another tab · this one only shows its time');
    for (const name of ['Pause focus', 'End session']) await expect(bar(second).getByRole('button', { name })).toHaveCount(0);
    // One fake clock for the browser: in each half minute only the first tab's heartbeat arrives.
    const beats = () => kinds(api).filter((k) => k === 'heartbeat').length;
    for (let round = 0; round < 2; round += 1) {
      const before = beats();
      await page.clock.runFor(30_000);
      await second.waitForTimeout(300);
      expect(beats()).toBe(before + 1);
    }
    await toChapter1(second);
    await second.waitForTimeout(300);
    expect(kinds(api)).not.toContain('page_turn');
    const before = kinds(api).length;
    await page.goto('/'); // the writer leaves the book and stops beating
    await second.clock.runFor(30_000);
    expect(kinds(api).length).toBe(before); // its lease is still fresh: the second tab still only watches
    await second.clock.runFor(60_000); // 90 s since the writer's last heartbeat: the lease (75 s) has lapsed
    await expect.poll(() => kinds(api).length).toBeGreaterThan(before); // the second tab writes now
    await expect(bar(second)).toContainText('Focus · badges are tucked away');
    await expect(bar(second).getByRole('button', { name: 'Pause focus' })).toBeVisible();
    await second.close();
  });
