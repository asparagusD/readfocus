// Find in the book (C38.5, issue 22: Edge's Ctrl+F) on the sample PDF (e2e/fixtures/books/sample.pdf): six pages, a
// title and 14 lines each ("Line 3 of page 2: the lamp threw a small circle of light."), titles "Chapter 1 Signals" on
// page 3 and "More on signals" on page 4. Only the pages near the view are drawn, so a count over all six is the
// search reading every page's text.
import { test, expect, book, openReader } from './fixtures.js';

test.use({ book: 'pdf' });

const bar = (page) => page.getByRole('search', { name: 'Find in the book' });
const input = (page) => bar(page).getByRole('textbox', { name: 'Find in the book' });
const count = (page) => bar(page).locator('.rf-find-count');
const pageBox = (page) => page.getByRole('textbox', { name: /^Page number/ });
/** The find bar and the ribbon (Save my place) do not overlap. */
async function besideRibbon(page) {
  const [a, b] = [await bar(page).boundingBox(), await page.getByRole('button', { name: 'Save my place' }).boundingBox()];
  expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
}
/** The text of the match shown (rf-find-current), and how many others are highlighted on the pages drawn. */
const marks = (page) => page.evaluate(() => ({
  current: [...(CSS.highlights.get('rf-find-current') ?? [])].map((range) => range.toString()),
  others: CSS.highlights.get('rf-find')?.size ?? 0,
}));

test('Ctrl+F finds across the pages; next and previous move the view, round the book', async ({ page }) => {
  await openReader(page);
  await expect(pageBox(page)).toHaveValue('1');
  await book(page).focus();
  await page.keyboard.press('Control+f');
  await expect(input(page)).toBeFocused();
  await input(page).fill('signals');
  await expect(count(page)).toHaveText('1 of 2');
  await expect(pageBox(page)).toHaveValue('3'); // the view moved to the first match from the page in view
  await expect.poll(() => marks(page)).toEqual({ current: ['Signals'], others: 1 }); // page 4's is drawn too
  await besideRibbon(page);

  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('2 of 2');
  await expect(pageBox(page)).toHaveValue('4');
  await expect.poll(async () => (await marks(page)).current).toEqual(['signals']);
  await page.keyboard.press('Shift+Enter');
  await expect(count(page)).toHaveText('1 of 2');
  await expect(pageBox(page)).toHaveValue('3');

  await bar(page).getByRole('button', { name: 'Next match' }).click();
  await bar(page).getByRole('button', { name: 'Next match' }).click(); // past the last match: the first again
  await expect(count(page)).toHaveText('1 of 2');
  await page.keyboard.press('F3');
  await expect(count(page)).toHaveText('2 of 2');
  await expect(bar(page).getByRole('status')).toHaveText('2 of 2'); // said once the whole book is searched
});

test('matches are counted on pages not drawn; a query with none says so', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Find in the book' }).click(); // the toolbar's Find
  await expect(input(page)).toBeFocused();
  await input(page).fill('circle  of LIGHT'); // case and spacing do not matter
  await expect(count(page)).toHaveText('1 of 84'); // 14 lines on each of 6 pages
  await expect(pageBox(page)).toHaveValue('1'); // the first match is on the page in view: no move
  expect(await page.locator('.rf-pdf-page[data-scale]').count()).toBeLessThan(6);

  await input(page).fill('zebra');
  await expect(count(page)).toHaveText('No matches');
  await expect(bar(page).getByRole('button', { name: 'Next match' })).toBeDisabled();
  await expect.poll(() => marks(page)).toEqual({ current: [], others: 0 });
});

test('Escape closes the bar and its highlights, focus back on the book; Ctrl+F brings the query back', async ({ page }) => {
  await openReader(page);
  await book(page).focus();
  await page.keyboard.press('Control+f');
  await input(page).fill('noise');
  await expect(count(page)).toHaveText('1 of 1');
  await expect(pageBox(page)).toHaveValue('5');
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await expect(book(page)).toBeFocused();
  expect(await page.evaluate(() => CSS.highlights.has('rf-find') || CSS.highlights.has('rf-find-current'))).toBe(false);

  await page.keyboard.press('Control+f');
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('noise');
  expect(await input(page).evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([0, 5]); // selected, to type over
  await expect(count(page)).toHaveText('1 of 1');
});

test('on a phone the bar fits across the top', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openReader(page);
  await book(page).focus();
  await page.keyboard.press('Control+f');
  await input(page).fill('page 2');
  await expect(count(page)).toHaveText('1 of 14');
  const box = await bar(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await besideRibbon(page); // the ribbon moves below the bar
});
