// Gate G6 (C19.G): a Markdown file (zipped with its figures) and a Jupyter notebook with plots, run
// through the upload's converter and packed by the shared builder (tools/make_converted_fixture.py),
// open in the original view's EPUB renderer with every image loaded and every equation drawn.
// Expected counts come from the sources: sample.md names 2 local figures (its remote one is never
// fetched) and has 1 inline and 1 display equation; sample.ipynb has an attachment, a PNG plot and an
// SVG output, and 1 inline and 1 display equation.
import { test, expect, BOOKS, book, openReader } from './fixtures.js';

const GATE = {
  'converted-md': { images: 2, math: 2 },
  'converted-nb': { images: 3, math: 2, captions: ['Output of cell 3', 'Output of cell 5'] },
};

/** What one section document draws. */
function drawn() {
  const box = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return {
    key: `${document.title}|${document.body?.textContent.length}`,
    images: [...document.querySelectorAll('img')].map((img) => ({ loaded: img.complete && img.naturalWidth > 0, alt: img.getAttribute('alt') })),
    math: [...document.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math')].map(box),
    captions: [...document.querySelectorAll('figcaption')].map((el) => el.textContent.trim()),
  };
}

for (const [key, want] of Object.entries(GATE)) {
  BOOKS[key] = { file: `${key}.epub`, format: 'epub', type: 'application/epub+zip', today: [0],
    chunks: ['Gate text that no book holds, so today runs from the start to the end of the book.'] };
  test.describe(key, () => {
    test.use({ book: key });

    test(`${key}: every image and equation is drawn`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openReader(page);
      await book(page).focus();
      const seen = new Map();
      for (let turn = 0; turn < 60; turn += 1) {
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
      const math = sections.flatMap((s) => s.math);
      console.log(`G6 ${key}: ${sections.length} sections, ${images.filter((i) => i.loaded).length}/${images.length} images loaded, `
        + `${math.filter(Boolean).length}/${math.length} equations drawn`);
      expect(images).toHaveLength(want.images);
      expect(images.every((i) => i.loaded && i.alt)).toBe(true);
      expect(math).toEqual(Array(want.math).fill(true));
      if (want.captions) expect(sections.flatMap((s) => s.captions)).toEqual(want.captions);
    });
  });
}
