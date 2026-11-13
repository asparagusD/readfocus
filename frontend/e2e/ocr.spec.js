// Scanned PDF pages (C19.4): tesseract.js reads them in this browser, for real (no mock), from our
// own origin; the words are posted, come back as a text layer, and word lookup works on them. A fully
// scanned book with no chunks opens pages-only and reads every page in turn. The API is mocked
// (fixtures.js keeps posted words, as the server would after cleaning).
import { test, expect, BOOKS, openReader, wordPoint } from './fixtures.js';

const scanned = { file: 'scanned.pdf', type: 'application/pdf', format: 'pdf', scanned: [1, 2], today: [0],
  chunks: ['Text that no page holds, so today runs from the start of the book.'] };
BOOKS.scanned = scanned;
BOOKS.scannedOnly = { ...scanned, pagesOnly: true };
const shots = process.env.E2E_SHOTS;

test.describe('a scanned page', () => {
  test.use({ book: 'scanned' });
  test.setTimeout(120_000);

  test('is read by OCR once, gets a text layer, and its words can be looked up', async ({ page, api }) => {
    await openReader(page);
    const note = page.locator('.rf-pdf-ocr').first();
    await expect(note).toHaveText('Making this page selectable…');
    if (shots) await page.screenshot({ path: `${shots}/ocr-note-${page.viewportSize().width}.png` });
    const shown = Date.now();
    await expect.poll(() => api.ocrPosts.length, { timeout: 90_000 }).toBeGreaterThan(0);
    const first = api.ocrPosts[0];
    console.log(`OCR: page ${first.page} posted ${((first.at - shown) / 1000).toFixed(1)} s after its note showed, ${first.words.length} words`);
    expect(first.engine).toBe('tesseract.js 7.0.0 eng');
    expect(first.words.map((w) => w.t.toLowerCase())).toContain('lamp');
    for (const w of first.words) { // boxes in points inside the page (Letter, 612 x 792)
      expect(w.b[0]).toBeGreaterThanOrEqual(0);
      expect(w.b[3]).toBeLessThanOrEqual(792);
    }
    await expect.poll(() => page.locator(`.rf-pdf-page[data-page="${first.page}"] .rf-ocr-word`).count(), { timeout: 15_000 })
      .toBeGreaterThan(20);
    const lamp = await wordPoint(page, 'lamp');
    expect(lamp).not.toBeNull();
    await page.mouse.move(5, 5);
    await page.mouse.move(lamp.x, lamp.y);
    await expect(page.locator('.rf-wordcard')).toBeVisible();
    expect(api.lookups.map((l) => l.term)).toContain('lamp');
    // Every shown page is read once, and its note goes away.
    await expect(page.locator('.rf-pdf-ocr')).toHaveCount(0, { timeout: 90_000 });
    expect(new Set(api.ocrPosts.map((p) => p.page)).size).toBe(api.ocrPosts.length);
  });
});

test.describe('a fully scanned book', () => {
  test.use({ book: 'scannedOnly' });
  test.setTimeout(150_000);

  test('opens pages-only, reads every page, then prepares its first session', async ({ page, api }) => {
    let engineAsked = null; // when tesseract's worker was first asked for: the start of the first page's reading
    page.on('request', (r) => { if (r.url().endsWith('/ocr/worker.min.js')) engineAsked ??= Date.now(); });
    await openReader(page);
    await expect(page.getByRole('button', { name: 'Done reading' })).toHaveCount(0);
    await expect(page.getByText(/^Reading this scan: [0-2] of 2 pages$/)).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/ocr-pages-only-${page.viewportSize().width}.png` });
    await expect(page.getByText('Preparing your first session…')).toBeVisible({ timeout: 140_000 });
    expect(api.ocrPosts.map((p) => p.page).sort()).toEqual([1, 2]);
    const [one, two] = api.ocrPosts;
    console.log(`OCR timing: first page ${((one.at - engineAsked) / 1000).toFixed(1)} s with the engine and model loading, `
      + `second page ${((two.at - one.at) / 1000).toFixed(1)} s (${one.words.length} and ${two.words.length} words)`);
    expect(api.starts).toBe(1);
  });
});
