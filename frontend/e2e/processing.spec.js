// C26.3: a book opens before it is processed. The reader opens it through GET /books/{id}/open with no session,
// saves every turn on the book and comes back to it, and says "Preparing the book… n%" until its ingest is
// done (C36: what is read is quizzed meanwhile); Quiz me and a focus session's questions say they are being prepared, and the session is kept. Mocked API.
import { book, expect, openReader, settled, shown, test } from './fixtures.js';

const PROCESSING = { status: 'processing', total_chunks: null, ingestion: { status: 'running', progress: 0.4, cursor: 0, attempts: 1, error: null } };
const shots = process.env.E2E_SHOTS;
const bar = (page) => page.getByRole('region', { name: 'Focus mode' });
const ready = (page) => page.getByRole('dialog', { name: 'Ready for your questions?' });

for (const kind of ['pdf', 'epub']) {
  test.describe(kind, () => {
    test.use({ book: kind });

    test('a book being processed opens at once, saves its place on the book and comes back to it', async ({ page, api }) => {
      api.processing = PROCESSING;
      await openReader(page);
      expect(api.opens).toBe(1);
      expect(api.starts).toBe(0); // no session, no plan
      await expect(page.getByRole('status').filter({ hasText: 'Preparing the book… 40%' })).toBeVisible();
      await expect(page.locator('.rf-ov-note .rf-note')).toHaveCount(0); // no "Suggested next"
      if (shots) await page.screenshot({ path: `${shots}/processing-${kind}-1440.png` });
      const before = await settled(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      const after = await settled(page, before);
      await page.waitForTimeout(1500); // the saver sends at most one place a second
      await expect.poll(() => api.position?.anchor?.kind).toBe(kind);
      expect(api.position.chunk_index).toBeUndefined();
      await page.reload();
      await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor({ timeout: 15_000 });
      await expect.poll(async () => (await shown(page)).start).toBe(after.start);
    });
  });
}

test('the preparing notice goes once the book is processed', async ({ page, api }) => {
  api.processing = PROCESSING;
  await openReader(page);
  const notice = page.getByRole('status').filter({ hasText: 'Preparing the book' });
  await expect(notice).toBeVisible();
  api.processing = { status: 'ready', total_chunks: 4, ingestion: { status: 'done', progress: 1, cursor: 4, attempts: 1, error: null } };
  await expect(notice).toHaveCount(0, { timeout: 8000 });
});

test('Quiz me says the questions are being prepared and the book stays open', async ({ page, api }) => {
  api.processing = PROCESSING;
  await page.route('http://localhost:8000/focus/quiz-me', (route) => route.fulfill({
    status: route.request().method() === 'OPTIONS' ? 204 : 409,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ detail: { code: 'preparing', message: 'The pages up to here are still being prepared. Try again in a moment.' } }),
  }));
  await openReader(page);
  await page.getByRole('button', { name: 'Quiz me' }).click();
  await page.getByRole('dialog', { name: 'Quiz me' }).getByRole('button', { name: 'This chapter' }).click();
  await expect(page.getByText('The pages up to here are still being prepared. Try again in a moment.')).toBeVisible();
  await expect(page).toHaveURL(/\/read\/e2e-book$/);
});

test('while the book is still prepared, Quiz me on the pages read opens its quiz', async ({ page, api }) => {
  api.processing = PROCESSING; // C36.3 (issue 27): a range already stored is quizzed before the whole book is
  const built = [];
  await page.route('http://localhost:8000/focus/quiz-me', (route) => {
    if (route.request().method() === 'POST') built.push(route.request().postDataJSON());
    return route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'qm-1', questions: [{ question: 'What was kept?', type: 'free_text' }], count: 1, words_in_range: 400 }),
    });
  });
  await openReader(page);
  await expect(page.getByRole('status').filter({ hasText: 'Preparing the book… 40%' })).toBeVisible();
  await page.getByRole('button', { name: 'Quiz me' }).click();
  await page.getByRole('dialog', { name: 'Quiz me' }).getByRole('button', { name: 'This chapter' }).click();
  await expect(page).toHaveURL(/\/quiz\/qm-1$/);
  expect(built).toHaveLength(1);
});

test('a focus session ended while the questions are prepared is kept, and its questions appear when ready', async ({ page, api }) => {
  test.setTimeout(60_000);
  api.processing = PROCESSING;
  api.focus.preparing = 1; // the first ask waits; the next, 5 s later, has the questions
  await openReader(page);
  await page.getByRole('switch', { name: 'Focus mode' }).click();
  await bar(page).getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => api.focus.events.length).toBeGreaterThan(0);
  await bar(page).getByRole('button', { name: 'End session' }).click();
  await page.getByRole('group', { name: 'Place the ribbon' }).getByRole('button', { name: /^Set ribbon on p\./ }).last().click();
  await expect(ready(page)).toContainText('The pages you read are still being prepared. Your session is kept');
  await expect(ready(page).getByRole('button', { name: 'Start questions' })).toBeDisabled();
  await expect(ready(page)).toContainText('Three short questions on what you read', { timeout: 20_000 });
  await expect(ready(page).getByRole('button', { name: 'Start questions' })).toBeEnabled();
});

test('at 375 the preparing notice fits the screen with no sideways scroll', async ({ page, api }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  api.processing = PROCESSING;
  await openReader(page);
  const notice = page.getByRole('status').filter({ hasText: 'Preparing the book… 40%' });
  await expect(notice).toBeVisible();
  const box = await notice.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  if (shots) await page.screenshot({ path: `${shots}/processing-pdf-375.png` });
});
