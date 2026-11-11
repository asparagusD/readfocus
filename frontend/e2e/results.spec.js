// The results page (C13.6), with the API mocked: from the test, after a refresh, not graded, failed.
import { test, expect } from './fixtures.js';
import { QUESTIONS, mockTest } from './testSession.js';

const shots = process.env.E2E_SHOTS;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body, status = 200) => route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 204, headers: CORS })
  : route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const GRADED = [
  { score: 10, max_score: 10, confidence: 'high', matched_concepts: ['opportunity cost'], missing_concepts: [],
    feedback: 'Correct: the answer is in life exchanged for it.' },
  { score: 4, max_score: 10, confidence: 'medium', matched_concepts: ['simplicity'], missing_concepts: ['quiet desperation'],
    feedback: 'You named simplicity but missed quiet desperation. See the passage: “The mass of men lead lives of quiet desperation.”' },
];
const SUBMITTED = {
  total_score: 14, max_score: 20, percentage: 70, per_question: GRADED, low_confidence_count: 0,
  pace_recommendation: { focus_duration_minutes: 18, re_read_mode: false },
  next_session: { mode: 'new', chunk_indices: [4, 5], focus_duration_minutes: 20, reason: 'We’ll open with quiet desperation, missed once today.' },
};

async function takeTest(page) {
  await mockTest(page, { submit: SUBMITTED });
  await page.goto('/test/t1');
  await page.getByRole('radio', { name: 'In life exchanged for it' }).check();
  await page.getByRole('button', { name: 'Question 2' }).click();
  await page.getByLabel('Your answer').fill('To live simply.');
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page).toHaveURL(/\/results\/t1$/);
}

test('from the test: score, verdict, each question with its evidence, chips and the next session', async ({ page }) => {
  await takeTest(page);
  await expect(page).toHaveTitle('Results · ReadFocus');
  await expect(page.getByRole('heading', { level: 1, name: 'Session results' })).toBeVisible();
  await expect(page.getByLabel('Score: 70%')).toBeVisible();
  await expect(page.getByText('1 correct · 1 partial')).toBeVisible();
  await expect(page.getByText('A good session. Most of it is holding.')).toBeVisible();
  const items = page.getByRole('listitem').filter({ has: page.locator('.rf-results__question') });
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Correct');
  await expect(items.nth(0).locator('.rf-results__question')).toHaveText('In “Economy”, how does Thoreau measure the cost of a thing?');
  await expect(items.nth(0)).toContainText('You answered In life exchanged for it'); // the "(b) " the grader reads is not shown
  await expect(items.nth(1)).toContainText('Partly');
  await expect(items.nth(1).locator('blockquote')).toHaveText('“The mass of men lead lives of quiet desperation.”');
  await expect(items.nth(1).locator('.rf-results__feedback')).toHaveText('You named simplicity but missed quiet desperation. See the passage:');
  await expect(page.getByRole('list', { name: 'Strengthened concepts' })).toContainText('opportunity cost');
  await expect(page.getByRole('list', { name: 'Strengthened concepts' })).toContainText('simplicity');
  await expect(page.getByRole('list', { name: 'Concepts to revisit' })).toContainText('quiet desperation');
  const nextCard = page.getByRole('region', { name: 'Next session' });
  await expect(nextCard).toContainText('The next pages');
  await expect(nextCard).toContainText('About 20 minutes. We’ll open with quiet desperation, missed once today.');
  if (shots) await page.screenshot({ path: `${shots}/results-1440.png`, fullPage: true });
  await nextCard.getByRole('button', { name: 'Start next session' }).click();
  await expect(page).toHaveURL(/\/read\/e2e-book$/);
});

test('a low-confidence grade is labelled gently and explained once', async ({ page }) => {
  await mockTest(page, { submit: { ...SUBMITTED, per_question: [GRADED[0], { ...GRADED[1], confidence: 'low' }] } });
  await page.goto('/test/t1');
  await page.getByRole('radio', { name: 'In money paid' }).check();
  await page.getByRole('button', { name: 'Question 2' }).click();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText('We couldn’t judge this one')).toBeVisible();
  await expect(page.getByText('We couldn’t judge one answer confidently, so it counts for less in your plan.')).toBeVisible();
  await expect(page.getByText('1 correct · 1 not judged')).toBeVisible();
});

test('opened fresh: rebuilt from the stored results and the book\'s pace', async ({ page }) => {
  const calls = [];
  await page.route(/localhost:8000\/(sessions\/t1|books\/e2e-book)$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET') calls.push(path);
    if (path === '/books/e2e-book') return json(route, { id: 'e2e-book', reading_progress: { pace_recommendation: { focus_duration_minutes: 15, re_read_mode: true } } });
    return json(route, { id: 't1', book_id: 'e2e-book', status: 'completed', test_questions: QUESTIONS,
      test_results: { total_score: 14, max_score: 20, answers: GRADED.map((g, i) => ({ ...g, user_answer: ['(b) In life exchanged for it', 'To live simply.'][i], question: QUESTIONS[i] })) } });
  });
  await page.goto('/results/t1');
  await expect(page.getByLabel('Score: 70%')).toBeVisible();
  await expect(page.getByText('You answered To live simply.')).toBeVisible();
  const nextCard = page.getByRole('region', { name: 'Next session' });
  await expect(nextCard).toContainText('A second look at today’s pages');
  await expect(nextCard).toContainText('About 15 minutes. Revisiting difficult material is how mastery is built.');
  expect(calls).toEqual(['/sessions/t1', '/books/e2e-book']);
});

test('a session not graded yet says so instead of leaving silently', async ({ page }) => {
  await page.route(/localhost:8000\/sessions\/t1$/, (route) => json(route, { id: 't1', book_id: 'e2e-book', status: 'reading', test_questions: QUESTIONS }));
  await page.goto('/results/t1');
  await expect(page.getByRole('heading', { name: 'This test hasn’t been graded yet.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to library' })).toBeVisible();
});

test('a failed load offers Try again', async ({ page }) => {
  let fail = true;
  await page.route(/localhost:8000\/(sessions\/t1|books\/e2e-book)$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (fail) return json(route, { detail: 'down' }, 503);
    if (path === '/books/e2e-book') return json(route, { id: 'e2e-book', reading_progress: null });
    return json(route, { id: 't1', book_id: 'e2e-book', status: 'completed', test_questions: QUESTIONS,
      test_results: { total_score: 20, max_score: 20, answers: GRADED.slice(0, 1).map((g) => ({ ...g, user_answer: 'x', question: QUESTIONS[0] })) } });
  });
  await page.goto('/results/t1');
  await expect(page.getByRole('alert')).toContainText('Your results didn’t load.');
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Score: 100%')).toBeVisible();
});

test.describe('at 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('one column, nothing wider than the screen', async ({ page }) => {
    await takeTest(page);
    await expect(page.getByLabel('Score: 70%')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    if (shots) await page.screenshot({ path: `${shots}/results-375.png`, fullPage: true });
  });
});
