// C38.9 (issue 22): Edge's reader shortcuts on the mocked API: Ctrl+G and Ctrl+Shift+G through find's matches,
// Ctrl+Alt+G to the page box, Ctrl+\ between fit page and fit width, Ctrl+= and Ctrl+- to zoom a PDF or size an EPUB's
// text (also pressed inside an EPUB's section). H, U, A, N and B keep their own tests.
import { test, expect, book, openReader, shown } from './fixtures.js';

const count = (page) => page.getByRole('search', { name: 'Find in the book' }).locator('.rf-find-count');
const zoom = (page) => page.getByRole('button', { name: /^Zoom: / });

test.describe('pdf', () => {
  test.use({ book: 'pdf' });

  test('Ctrl+G opens find and steps through the matches; Ctrl+Shift+G goes back', async ({ page }) => {
    await openReader(page);
    await book(page).focus();
    await page.keyboard.press('Control+g');
    const input = page.getByRole('textbox', { name: 'Find in the book' });
    await expect(input).toBeFocused();
    await input.fill('signals');
    await expect(count(page)).toHaveText('1 of 2');
    await page.keyboard.press('Control+g');
    await expect(count(page)).toHaveText('2 of 2');
    await page.keyboard.press('Control+Shift+g');
    await expect(count(page)).toHaveText('1 of 2');
  });

  test('Ctrl+Alt+G goes to the page box; Ctrl+\\ fits the page or its width; Ctrl+= and Ctrl+- zoom', async ({ page }) => {
    await openReader(page);
    await book(page).focus();
    await page.keyboard.press('Control+Alt+g');
    const box = page.getByRole('textbox', { name: /^Page number/ });
    await expect(box).toBeFocused();
    await page.keyboard.type('4');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await shown(page)).start).toBe('4');

    await book(page).focus();
    await expect(zoom(page)).toHaveText('Fit page');
    await page.keyboard.press('Control+\\');
    await expect(zoom(page)).toHaveText('Fit width');
    await page.keyboard.press('Control+\\');
    await expect(zoom(page)).toHaveText('Fit page');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await expect(zoom(page)).toHaveText('125%');
    await page.keyboard.press('Control+-');
    await expect(zoom(page)).toHaveText('Fit width');
    expect(await page.evaluate(() => window.visualViewport.scale)).toBe(1); // the page itself was not zoomed
  });
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test('Ctrl+= and Ctrl+- size the text, from the page or inside the section', async ({ page }) => {
    await openReader(page);
    const section = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith('blob:'));
    const size = () => section.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const before = await size();
    await book(page).focus();
    await page.keyboard.press('Control+=');
    await expect.poll(size).toBeGreaterThan(before);
    const larger = await size();
    await section.locator('body').press('Control+-'); // inside the section's own document
    await expect.poll(size).toBeLessThan(larger);
  });
});
