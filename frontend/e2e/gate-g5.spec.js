// Gate G5 (C18.G): every test EPUB, paged through end to end in the original view (foliate in
// Edge, as a reader sees it), draws each packaged image its spine documents hold (and loads no
// remote one), with its caption
// (figcaption or alt), and gives every MathML element a box. The expected counts come from the
// markup (scripts/dev/g5_epub_expect.py, file in G5_EXPECT). The session's chunk is text no book
// holds, so the reader opens at the book's start with no end of today's reading but the book's.
import { readFileSync } from 'node:fs';
import { test, expect, BOOKS, book, openReader } from './fixtures.js';

const EXPECT = process.env.G5_EXPECT ? JSON.parse(readFileSync(process.env.G5_EXPECT, 'utf8')) : {};

/** What one section document draws: its images (loaded or not), captions and math boxes. */
function drawn() {
  const box = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const images = [...document.querySelectorAll('img, svg image')].map((el) => ({
    loaded: el.tagName.toLowerCase() === 'img' ? el.complete && el.naturalWidth > 0 : box(el),
    caption: (el.closest('figure')?.querySelector('figcaption')?.textContent || el.getAttribute('alt') || '').trim(),
  }));
  return {
    key: `${document.title}|${document.body?.textContent.length}|${document.images.length}`,
    images,
    captions: [...document.querySelectorAll('figcaption')].map((el) => el.textContent.trim()).filter(Boolean),
    math: [...document.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math')].map(box),
  };
}

for (const [key, expected] of Object.entries(EXPECT)) {
  BOOKS[key] = { file: `${key}.epub`, source: expected.file, format: 'epub', type: 'application/epub+zip', today: [0],
    chunks: ['G5 text that no book holds, so today runs from the start to the end of the book.'] };
  test.describe(key, () => {
    test.use({ book: key });

    test(`${key}: every image, caption and equation is drawn`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openReader(page);
      await book(page).focus();
      const seen = new Map();
      for (let turn = 0; turn < 600; turn += 1) {
        for (const frame of page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached())) {
          const found = await frame.evaluate(drawn).catch(() => null);
          if (found && found.key !== '||0') seen.set(found.key, found);
        }
        const before = await page.locator('.rf-ov').getAttribute('data-end');
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(250);
        if (await page.locator('.rf-end').count()) break; // past the book's last page
        await expect.poll(() => page.locator('.rf-ov').getAttribute('data-end'), { timeout: 3000 }).not.toBe(before)
          .catch(() => {});
        if (await page.locator('.rf-ov').getAttribute('data-end') === before) break;
      }
      const sections = [...seen.values()];
      const images = sections.flatMap((s) => s.images);
      const want = {
        images: expected.sections.reduce((n, s) => n + s.images, 0),
        remote: expected.sections.reduce((n, s) => n + s.remote, 0),
        captions: expected.sections.reduce((n, s) => n + s.captions.length, 0),
        math: expected.sections.reduce((n, s) => n + s.math, 0),
      };
      const got = {
        sections: sections.length, images: images.length, loaded: images.filter((i) => i.loaded).length,
        captioned: images.filter((i) => i.caption).length,
        captions: sections.reduce((n, s) => n + s.captions.length, 0),
        math: sections.reduce((n, s) => n + s.math.length, 0), mathDrawn: sections.reduce((n, s) => n + s.math.filter(Boolean).length, 0),
      };
      console.log(`G5 ${key}: expected ${JSON.stringify({ sections: expected.sections.length, ...want })} drawn ${JSON.stringify(got)}`);
      expect(got.images).toBe(want.images + want.remote);
      expect(got.loaded).toBe(want.images); // every packaged image, and no remote one
      expect(got.captions).toBe(want.captions);
      expect(got.math).toBe(want.math);
      expect(got.mathDrawn).toBe(want.math);
    });
  });
}
