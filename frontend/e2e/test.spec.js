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
