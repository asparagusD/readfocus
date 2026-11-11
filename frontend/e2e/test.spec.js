// The comprehension test (C13.5), on the real /test page with the API mocked.
import { test, expect } from './fixtures.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
export const QUESTIONS = [
  { question: 'In “Economy”, how does Thoreau measure the cost of a thing?\n(a) In money paid  (b) In life exchanged for it', type: 'factual',
    options: ['In money paid', 'In life exchanged for it'] },
  { question: 'In your own words, why did Thoreau go to the woods?', type: 'summary' },
];

/** Answer GET /sessions/{id}, evaluate-single and submit-answers; returns what was sent. */
export async function mockTest(page, { questions = QUESTIONS, submit = { total_score: 10, max_score: 20, percentage: 50, per_question: [] }, failSubmit = 0 } = {}) {
  const sent = { evaluations: [], submits: [] };
  await page.route(/localhost:8000\/sessions\/t1(\/.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (path === '/sessions/t1') return json({ id: 't1', book_id: 'e2e-book', test_questions: questions });
    if (path === '/sessions/t1/evaluate-single') { sent.evaluations.push(JSON.parse(req.postData())); return json({ ok: true }); }
    if (path === '/sessions/t1/submit-answers') {
      sent.submits.push(JSON.parse(req.postData()));
      if (sent.submits.length <= failSubmit) return json({ detail: 'Grading is busy' }, 503);
      return json(submit);
    }
    return route.fallback();
  });
  return sent;
}

test('when time runs out, the answers typed so far are submitted', async ({ page }) => {
  // Regression (docs/DEBUG_LOG.md, C13.5): the timer's interval kept the first render's submit,
  // so the automatic submit sent empty answers and 0 seconds.
  await page.clock.install();
  const sent = await mockTest(page, { questions: [QUESTIONS[1], { question: 'What did he build?', type: 'factual' }] });
  await page.goto('/test/t1');
  await page.getByRole('textbox').fill('To live deliberately.');
  await page.clock.runFor(301_000);
  await expect.poll(() => sent.submits.length).toBe(1);
  expect(sent.submits[0]).toEqual({ answers: ['To live deliberately.', ''], time_taken_seconds: 300 });
  await expect(page).toHaveURL(/\/results\/t1$/);
});

const shots = process.env.E2E_SHOTS;

test('one question at a time: cards by key, Enter to go on, a written answer, the same calls', async ({ page }) => {
  const sent = await mockTest(page);
  await page.goto('/test/t1');
  await expect(page).toHaveTitle('Test · ReadFocus');
  const prompt = page.getByRole('heading', { level: 1 });
  await expect(prompt).toHaveText('In “Economy”, how does Thoreau measure the cost of a thing?'); // the options are not repeated in it
  await expect(page.getByText('Question 1 of 2 · Multiple choice')).toBeVisible();
  const group = page.getByRole('radiogroup', { name: /how does Thoreau measure/ });
  await expect(group.getByRole('radio')).toHaveCount(2);
  if (shots) await page.screenshot({ path: `${shots}/test-mcq-1440.png` });
  await page.keyboard.press('2');
  await expect(group.getByRole('radio', { name: 'In life exchanged for it' })).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Question 2 of 2 · Written answer')).toBeVisible();
  await expect(prompt).toBeFocused();
  expect(sent.evaluations).toEqual([{ index: 0, answer: '(b) In life exchanged for it' }]);
  await page.getByLabel('Your answer').fill('To live deliberately and front the essential facts.');
  await expect(page.getByRole('button', { name: 'Question 1, answered' })).not.toHaveAttribute('aria-current');
  await expect(page.getByRole('button', { name: 'Question 2, answered' })).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(group.getByRole('radio', { name: 'In life exchanged for it' })).toBeChecked();
  await page.getByRole('button', { name: 'Question 2, answered' }).click();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page).toHaveURL(/\/results\/t1$/);
  expect(sent.submits).toHaveLength(1);
  expect(sent.submits[0].answers).toEqual(['(b) In life exchanged for it', 'To live deliberately and front the essential facts.']);
  expect(sent.submits[0].time_taken_seconds).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => localStorage.getItem('rf-test-answers:t1'))).toBeNull();
});

test('answers are kept across a reload until they are submitted', async ({ page }) => {
  await mockTest(page);
  await page.goto('/test/t1');
  await page.getByRole('radio', { name: 'In money paid' }).check();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'In money paid' })).toBeChecked();
});

test('the timer is calm until the last 30 seconds, then warns once', async ({ page }) => {
  await page.clock.install();
  await mockTest(page);
  await page.goto('/test/t1');
  const timer = page.locator('.rf-timer');
  await expect(page.getByRole('timer')).toHaveAccessibleName('Time left: 5 min 0 s');
  await page.clock.runFor(269_000);
  await expect(timer).not.toHaveAttribute('data-warn');
  await page.clock.runFor(2_000);
  await expect(timer).toHaveAttribute('data-warn', 'true');
  await expect(page.locator('.rf-timer__notice')).toHaveText('30 seconds left.');
  if (shots) await page.screenshot({ path: `${shots}/test-warn-1440.png` });
});

test('Leave test asks first; Keep going stays, Leave test goes to the shelf', async ({ page }) => {
  await mockTest(page);
  await page.goto('/test/t1');
  await page.getByRole('button', { name: 'Leave test' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave this test?' });
  await expect(dialog).toContainText('Your answers so far are kept');
  await dialog.getByRole('button', { name: 'Keep going' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Leave test' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave test' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('a failed submit keeps the answers and can be tried again', async ({ page }) => {
  const sent = await mockTest(page, { failSubmit: 1 });
  await page.goto('/test/t1');
  await page.getByRole('radio', { name: 'In money paid' }).check();
  await page.getByRole('button', { name: 'Question 2' }).click();
  await page.getByLabel('Your answer').fill('Deliberately.');
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText(/couldn’t be graded just now: Grading is busy/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit answers' })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page).toHaveURL(/\/results\/t1$/);
  expect(sent.submits).toHaveLength(2);
  expect(sent.submits[1].answers).toEqual(['(a) In money paid', 'Deliberately.']);
});

test.describe('at 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the chrome fits and every target is 44 px', async ({ page }) => {
    await mockTest(page);
    await page.goto('/test/t1');
    await expect(page.getByRole('radio')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    const small = await page.locator('button:visible, label.rf-option').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44).length);
    expect(small).toBe(0);
    if (shots) await page.screenshot({ path: `${shots}/test-375.png`, fullPage: true });
  });
});
