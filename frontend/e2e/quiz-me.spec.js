// C23.7b: Quiz me outside focus mode. The toolbar's Quiz me asks which stretch (this chapter, or since the last
// quiz), POST /focus/quiz-me builds it to the end of the page shown, the questions have no clock, submit-answers
// grades them, and the results say Quiz me never earns points. Mocked API.
import { clickTool, expect, openReader, reveal, test } from './fixtures';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const QUESTIONS = [
  { question: 'What did the lamp throw?\n(a) A shadow\n(b) A small circle of light', type: 'multiple_choice', options: ['A shadow', 'A small circle of light'] },
  { question: 'Why read slowly?', type: 'free_text' },
  { question: 'What was kept?', type: 'free_text' },
];

async function mockQuizMe(page, { status = 200 } = {}) {
  const calls = { built: [], submitted: [] };
  const reply = (route, body, code = 200) => (route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  await page.route('http://localhost:8000/focus/quiz-me', (route) => {
    if (route.request().method() === 'POST') calls.built.push(JSON.parse(route.request().postData()));
    return status === 200
      ? reply(route, { session_id: 'qm-1', questions: QUESTIONS, count: 3, words_in_range: 1200 })
      : reply(route, { detail: 'There is nothing to ask about yet. Read a little further first.' }, status);
  });
  await page.route('http://localhost:8000/sessions/qm-1', (route) => reply(route, { id: 'qm-1', book_id: 'e2e-book', status: 'testing', test_questions: QUESTIONS }));
  await page.route('http://localhost:8000/sessions/qm-1/evaluate-single', (route) => reply(route, { status: 'graded' }));
  await page.route('http://localhost:8000/sessions/qm-1/submit-answers', (route) => {
    if (route.request().method() === 'POST') calls.submitted.push(JSON.parse(route.request().postData()));
    return reply(route, { total_score: 20, max_score: 30, percentage: 66.7, per_question: [
      { score: 10, max_score: 10, feedback: 'Right.', confidence: 'high' },
      { score: 10, max_score: 10, feedback: 'Right.', confidence: 'high' },
      { score: 0, max_score: 10, feedback: 'Say what was kept.', confidence: 'high' }] });
  });
  return calls;
}

test('Quiz me: choose since the last quiz, answer with no clock, results with no points', async ({ page }) => {
  const calls = await mockQuizMe(page);
  await openReader(page);
  await clickTool(page, page.getByRole('button', { name: 'Quiz me' }));
  const dialog = page.getByRole('dialog', { name: 'Quiz me' });
  await expect(dialog).toContainText('No points, and your answers still update what you’ve mastered.');
  await expect(dialog.getByRole('button')).toContainText(['This chapter', 'Since my last quiz']);
  await dialog.getByRole('button', { name: 'Since my last quiz' }).click();
  await expect(page).toHaveURL(/\/quiz\/qm-1$/);
  expect(calls.built).toHaveLength(1);
  expect(calls.built[0]).toMatchObject({ book_id: 'e2e-book', scope: 'since_last', anchor: { kind: 'pdf' } });
  expect(calls.built[0].anchor.quads[0][1]).toBeGreaterThan(500); // the end of the page shown
  await expect(page.getByText('No points, just practice')).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  await page.getByRole('radio', { name: /A small circle of light/ }).click();
  await page.locator('[data-test-next]').click();
  await page.getByLabel('Your answer').fill('To keep the thread.');
  await page.locator('[data-test-next]').click();
  await expect(page.getByText(/^Question 3 of 3/)).toBeVisible();
  await page.getByLabel('Your answer').fill('The place.');
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page).toHaveURL(/\/results\/qm-1$/);
  expect(calls.submitted).toHaveLength(1);
  await expect(page.getByText('Quiz me never earns points. Your answers still update what you’ve mastered.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'How this session scored' })).toHaveCount(0);
});

test('Quiz me: this chapter; nothing to ask yet is said kindly and the book stays open', async ({ page }) => {
  const calls = await mockQuizMe(page, { status: 409 });
  await openReader(page);
  await clickTool(page, page.getByRole('button', { name: 'Quiz me' }));
  await page.getByRole('dialog', { name: 'Quiz me' }).getByRole('button', { name: 'This chapter' }).click();
  await expect(page.getByText('There is nothing to ask about yet. Read a little further first.')).toBeVisible();
  expect(calls.built[0].scope).toBe('chapter');
  await expect(page).toHaveURL(/\/read\/e2e-book$/);
  await expect(page.getByRole('dialog', { name: 'Quiz me' })).toHaveCount(0);
});

test('at 375 the Quiz me button and its dialog fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openReader(page);
  const button = await reveal(page, page.getByRole('button', { name: 'Quiz me' })); // C38.4b: in More tools
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await button.click();
  await expect(page.getByRole('dialog', { name: 'Quiz me' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/quiz-me-375.png` });
});

test('Quiz me is not offered in focus mode', async ({ page }) => {
  await openReader(page);
  await expect(await reveal(page, page.getByRole('button', { name: 'Quiz me' }))).toBeVisible();
  await clickTool(page, page.getByRole('switch', { name: 'Focus mode' }));
  await expect(page.getByRole('button', { name: 'Quiz me' })).toHaveCount(0);
});

test('opening Quiz me asks the server to start the questions at the place shown', async ({ page }) => {
  await mockQuizMe(page);
  const prepared = [];
  await page.route('http://localhost:8000/focus/quiz-me/prepare', (route) => {
    if (route.request().method() === 'POST') prepared.push(route.request().postDataJSON());
    return route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 202, headers: { ...CORS, 'Content-Type': 'application/json' }, body: '{"queued": 2}' });
  });
  await openReader(page);
  await clickTool(page, page.getByRole('button', { name: 'Quiz me' }));
  await expect(page.getByRole('dialog', { name: 'Quiz me' })).toBeVisible();
  await expect.poll(() => prepared.length).toBe(1);
  expect(prepared[0].book_id).toBe('e2e-book');
  expect(prepared[0].anchor.kind).toBeTruthy();
});

test('the quiz shows the questions Quiz me handed it; opened by its address it reads them from the server', async ({ page }) => {
  await mockQuizMe(page);
  const reads = [];
  page.on('request', (r) => { if (r.method() === 'GET' && r.url().endsWith('/sessions/qm-1')) reads.push(r.url()); });
  await openReader(page);
  await clickTool(page, page.getByRole('button', { name: 'Quiz me' }));
  await page.getByRole('dialog', { name: 'Quiz me' }).getByRole('button', { name: 'This chapter' }).click();
  await expect(page).toHaveURL(/\/quiz\/qm-1$/);
  await expect(page.getByText('What did the lamp throw?')).toBeVisible();
  expect(reads).toHaveLength(0); // C36.7c: no second trip for the questions just built
  await page.evaluate(() => window.history.replaceState(null, '')); // as a visit by address: nothing handed over
  await page.reload();
  await expect(page.getByText('What did the lamp throw?')).toBeVisible();
  expect(reads).toHaveLength(1);
});
