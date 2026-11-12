// The reading page's polish (C13.4; on the original view since C17.5), on the real /read page with the
// API mocked: the first-page note, the closing page with its lamp and Start test, the leave dialog,
// and the lamp under reduced motion. The note and the closing page run on a PDF and an EPUB.
import { test, expect, book, openReader, shown, spoken } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body) => route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

for (const kind of ['pdf', 'epub']) {
  test.describe(kind, () => {
    test.use({ book: kind });

    test("the first page of today's reading carries the note with a small lamp, never inside the book", async ({ page }) => {
      await openReader(page);
      const note = page.locator('.rf-ov-note .rf-note');
      await expect(note).toContainText('Today: about 20 minutes. A steady pace for this book.');
      await expect(note.locator('.rf-illustration')).toHaveAttribute('aria-hidden', 'true');
      const box = await note.locator('.rf-illustration').boundingBox();
      expect(Math.round(box.width)).toBe(40);
      if (shots) await page.screenshot({ path: `${shots}/reading-first-${kind}-1440.png` });
      await page.getByRole('button', { name: 'Hide this note' }).click();
      await expect(note).toHaveCount(0);
    });

    test('the last page: the lamp pulses once, and Start test finishes reading with the same call', async ({ page }) => {
      const finishes = [];
      await page.route('http://localhost:8000/sessions/e2e-session/finish-reading', (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        finishes.push(JSON.parse(route.request().postData() || '{}'));
        return json(route, { test_questions: [] });
      });
      await page.route('http://localhost:8000/sessions/e2e-session', (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        return json(route, { id: 'e2e-session', book_id: 'e2e-book', test_questions: [{ question: 'What did the lamp do?', type: 'free_text' }] });
      });
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('End');
      await expect(spoken(page)).toHaveText("End of today's reading");
      const end = page.locator('.rf-end');
      await expect(end.getByRole('heading', { name: "That's today's reading." })).toBeVisible();
      const glow = end.locator('[data-part="glow"]');
      await expect.poll(() => glow.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.animationName, s.animationDuration, s.animationIterationCount];
      })).toEqual(['rf-lamp-pulse', '1.4s', '1']);
      if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/reading-end-${kind}-1440.png` }); }
      await end.getByRole('button', { name: 'Start test' }).click();
      await expect(page).toHaveURL(/\/test\/e2e-session$/);
      expect(finishes).toHaveLength(1);
      expect(Number.isInteger(finishes[0].actual_duration_minutes)).toBe(true);
    });

    test('a theme change or resize on the closing page keeps the closing page, and Home leaves it', async ({ page }) => {
      await openReader(page);
      const first = await shown(page);
      await book(page).focus();
      await page.keyboard.press('End');
      await expect(spoken(page)).toHaveText("End of today's reading");
      await page.evaluate(() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
      await page.waitForTimeout(500);
      await expect(spoken(page)).toHaveText("End of today's reading");
      await page.setViewportSize({ width: 1300, height: 860 });
      await page.waitForTimeout(500);
      await expect(page.locator('.rf-end').getByRole('button', { name: 'Start test' })).toBeVisible();
      await book(page).focus();
      await page.keyboard.press('Home');
      await expect(page.locator('.rf-end')).toHaveCount(0);
      await expect.poll(async () => (await shown(page)).start).toBe(first.start); // back at today's start
    });
  });
}

test('leaving asks first, keeps reading by default, and Leave goes to the shelf', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Abandon session' }).click();
  const dialog = page.getByRole('dialog', { name: "Leave today's reading?" });
  await expect(dialog).toContainText('Your place in the book is kept.');
  const buttons = await dialog.getByRole('button').allTextContents();
  expect(buttons).toEqual(['Leave', 'Keep reading']);
  await dialog.getByRole('button', { name: 'Keep reading' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Abandon session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('under reduced motion the closing lamp does not pulse', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openReader(page);
  await book(page).focus();
  await page.keyboard.press('End');
  await expect(page.locator('.rf-end')).toHaveCount(1);
  const glow = page.locator('.rf-end [data-part="glow"]');
  await expect.poll(() => glow.evaluate((el) => getComputedStyle(el).animationDuration)).toBe('1e-05s'); // base.css: 0.01 ms
});
