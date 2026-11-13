// A book made by the shared EPUB 3 builder (C19.1, tools/make_converted_fixture.py) opens in the
// original view's EPUB renderer like any EPUB: its nav is the contents, every image is drawn at the
// size the builder wrote with the alt it gave, display MathML gets a box, and code keeps its spaces.
import { test, expect, BOOKS, book, openReader } from './fixtures.js';

BOOKS.converted = { file: 'converted.epub', format: 'epub', type: 'application/epub+zip', today: [0],
  chunks: ['Converted text that no book holds, so today runs from the start to the end of the book.'] };
test.use({ book: 'converted' });

/** What one section document draws. */
function drawn() {
  const box = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return {
    key: `${document.title}|${document.body?.textContent.length}`,
    images: [...document.querySelectorAll('img')].map((img) => ({
      loaded: img.complete && img.naturalWidth > 0, alt: img.getAttribute('alt'),
      width: img.getAttribute('width'), height: img.getAttribute('height'),
    })),
    math: [...document.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math')].map(box),
    code: [...document.querySelectorAll('pre')].map((pre) => ({ text: pre.textContent, space: getComputedStyle(pre).whiteSpace })),
  };
}

test('the contents are the builder\'s nav, from the headings', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Contents' }).click();
  const items = page.getByRole('dialog', { name: 'Contents' }).locator('.rf-contents-item');
  await expect(items).toHaveText([/^Getting started/, /^A plot/, /^Equations and code/]);
});

test('images, equation and code are drawn as built', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openReader(page);
  await book(page).focus();
  const seen = new Map();
  for (let turn = 0; turn < 40; turn += 1) {
    for (const frame of page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached())) {
      const found = await frame.evaluate(drawn).catch(() => null);
      if (found && found.key !== '|0') seen.set(found.key, found);
    }
    const before = await page.locator('.rf-ov').getAttribute('data-end');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    if (await page.locator('.rf-end').count()) break;
    await expect.poll(() => page.locator('.rf-ov').getAttribute('data-end'), { timeout: 3000 }).not.toBe(before).catch(() => {});
    if (await page.locator('.rf-ov').getAttribute('data-end') === before) break;
  }
  const sections = [...seen.values()];
  const images = sections.flatMap((s) => s.images);
  expect(images).toEqual([
    { loaded: true, alt: "A plot of the lamp's light", width: '320', height: '160' },
    { loaded: true, alt: 'Figure 2', width: '240', height: '80' },
  ]);
  expect(sections.flatMap((s) => s.math)).toEqual([true]);
  // The renderer's BOOK_CSS (C17.3) wraps every book's code (pre-wrap) over the package's `pre`;
  // either keeps every space, which is what is checked here.
  const code = sections.flatMap((s) => s.code);
  expect(code.map((c) => c.text)).toEqual(['def area(r):\n    """A circle\'s area."""\n    return 3.14159 * r ** 2\n']);
  expect(['pre', 'pre-wrap']).toContain(code[0].space);
});
