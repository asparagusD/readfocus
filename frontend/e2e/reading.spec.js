// The reading page's polish (C13.4; on the original view since C17.5; C26.5: the book opens at the reader's
// place with no suggested reading), on the real /read page with the API mocked: no note over the first page,
// the closing page at the end of the book with its lamp, no fixed timer (C23.7), and the lamp under reduced
// motion. The closing page runs on a PDF and an EPUB.
import { test, expect, book, openReader, shown, spoken } from './fixtures.js';

const shots = process.env.E2E_SHOTS;

for (const kind of ['pdf', 'epub']) {
  test.describe(kind, () => {
    test.use({ book: kind });

    test('the book opens with no suggested-reading note', async ({ page }) => {
      await openReader(page);
      await expect(page.locator('.rf-ov-note .rf-note')).toHaveCount(0);
      await expect(page.getByText(/Suggested next/)).toHaveCount(0);
      if (shots) await page.screenshot({ path: `${shots}/reading-first-${kind}-1440.png` });
    });

    test('the last page: the lamp pulses once, and there is no test to start (C23.7)', async ({ page }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('End');
      await expect(spoken(page)).toHaveText('End of the book');
      const end = page.locator('.rf-end');
      await expect(end.getByRole('heading', { name: "That's the end of the book." })).toBeVisible();
      await expect(end).toContainText('Your place is kept.');
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
      await book(page).focus();
      await page.keyboard.press('End');
      await expect(spoken(page)).toHaveText('End of the book');
      const last = await shown(page);
      await page.evaluate(() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
      await page.waitForTimeout(500);
      await expect(spoken(page)).toHaveText('End of the book');
      await page.setViewportSize({ width: 1300, height: 860 });
      await page.waitForTimeout(500);
      await expect(page.locator('.rf-end').getByRole('heading', { name: "That's the end of the book." })).toBeVisible();
      await book(page).focus();
      await page.keyboard.press('Home');
      if (kind === 'pdf') await expect(page.locator('.rf-end')).not.toBeInViewport(); // C38.2: below the last page
      else await expect(page.locator('.rf-end')).toHaveCount(0);
      await expect.poll(async () => (await shown(page)).start).not.toBe(last.start); // back towards the start
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
