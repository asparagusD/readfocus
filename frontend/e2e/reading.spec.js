// The reading page's polish (C13.4; on the original view since C17.5), on the real /read page with the
// API mocked: the first-page "Suggested next" note, the closing page with its lamp, no fixed timer (C23.7),
// and the lamp under reduced motion. The note and the closing page run on a PDF and an EPUB.
import { test, expect, book, openReader, shown, spoken } from './fixtures.js';

const shots = process.env.E2E_SHOTS;

for (const kind of ['pdf', 'epub']) {
  test.describe(kind, () => {
    test.use({ book: kind });

    test("the first page of today's reading carries the note with a small lamp, never inside the book", async ({ page }) => {
      await openReader(page);
      const note = page.locator('.rf-ov-note .rf-note');
      await expect(note).toContainText('Suggested next: these pages. A steady pace for this book.');
      await expect(note).not.toContainText('minutes');
      await expect(note.locator('.rf-illustration')).toHaveAttribute('aria-hidden', 'true');
      const box = await note.locator('.rf-illustration').boundingBox();
      expect(Math.round(box.width)).toBe(40);
      if (shots) await page.screenshot({ path: `${shots}/reading-first-${kind}-1440.png` });
      await page.getByRole('button', { name: 'Hide this note' }).click();
      await expect(note).toHaveCount(0);
    });

    test('the last page: the lamp pulses once, and there is no test to start (C23.7)', async ({ page }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('End');
      await expect(spoken(page)).toHaveText("End of today's reading");
      const end = page.locator('.rf-end');
      await expect(end.getByRole('heading', { name: "That's today's suggested reading." })).toBeVisible();
      await expect(end).toContainText('Read on as far as you like; your place is kept.');
      const glow = end.locator('[data-part="glow"]');
      await expect.poll(() => glow.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.animationName, s.animationDuration, s.animationIterationCount];
      })).toEqual(['rf-lamp-pulse', '1.4s', '1']);
      if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/reading-end-${kind}-1440.png` }); }
      await expect(end.getByRole('button', { name: 'Start test' })).toHaveCount(0);
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
      await expect(page.locator('.rf-end').getByRole('heading', { name: "That's today's suggested reading." })).toBeVisible();
      await book(page).focus();
      await page.keyboard.press('Home');
      await expect(page.locator('.rf-end')).toHaveCount(0);
      await expect.poll(async () => (await shown(page)).start).toBe(first.start); // back at today's start
    });
  });
}

test('C23.7: no fixed timer, Done reading or abandon; Back goes to the shelf', async ({ page }) => {
  await openReader(page);
  await expect(page.getByRole('timer')).toHaveCount(0);
  for (const name of ['Start the timer', 'Done reading', 'Abandon session']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Back to the library' }).click();
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
