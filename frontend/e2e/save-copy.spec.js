// Save a copy with my marks (C40.4c, issue 24, D2: Edge's Save and Save as) on the sample PDF (six pages). The reader's
// highlight with a comment, an ink stroke and a text box are seeded; the copy is read back here with pdf-lib.
// C40.4d: an EPUB's highlights as Markdown.
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import { test, expect, openReader, clickTool, book } from './fixtures.js';

test.use({ book: 'pdf' });

function seed(api) {
  api.annotations.push({ id: 'ann-1', style: 'highlight', color: 'honey', orphaned: false, comment: 'Read this twice',
    anchors: [{ kind: 'pdf', page: 1, quads: [[72, 120, 300, 134]], text: 'the lamp threw' }],
    position_start: 1e6 + 12000, position_end: 1e6 + 13400, text_snapshot: 'the lamp threw' });
  api.marks.push({ id: 'mark-ink', kind: 'ink', page: 2, color: 'poppy', data: { points: [[100, 200, 0.5], [180, 230, 0.6], [260, 210, 0.5]], width: 3 } });
  api.marks.push({ id: 'mark-text', kind: 'text', page: 3, color: 'ink', data: { x: 300, y: 600, width: 192, text: 'My note', size: 12 } });
}

/** Each page's annotation subtypes, and the highlight's comment. */
async function marksIn(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages().map((p) => (p.node.Annots()?.asArray() ?? []).map((ref) => pdf.context.lookup(ref)));
  const comment = pages[0].find((a) => a.get(PDFName.of('Subtype')).toString() === '/Highlight')?.get(PDFName.of('Contents'))?.decodeText();
  return { subtypes: pages.map((list) => list.map((a) => a.get(PDFName.of('Subtype')).toString())), comment };
}

const save = (page) => page.getByRole('button', { name: 'Save', exact: true });
const saveAs = (page) => page.getByRole('button', { name: 'Save as' });

test('Save downloads the book with the highlight, its comment, the ink and the text box written in', async ({ page, api }) => {
  seed(api);
  await openReader(page);
  const downloaded = page.waitForEvent('download');
  await clickTool(page, save(page));
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('Walden (with my marks).pdf');
  const { subtypes, comment } = await marksIn(await readFile(await file.path()));
  expect(subtypes.slice(0, 3)).toEqual([['/Highlight', '/Popup'], ['/Ink'], ['/FreeText']]);
  expect(comment).toBe('Read this twice');
  await expect(page.getByText('Saved a copy with your marks')).toBeVisible();
});

test('Ctrl+S saves too, without the browser saving the page', async ({ page, api }) => {
  seed(api);
  await openReader(page);
  await book(page).focus();
  const downloaded = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('Walden (with my marks).pdf');
  expect((await marksIn(await readFile(await file.path()))).subtypes[1]).toEqual(['/Ink']);
});

test.describe('Save as', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { // the browser's file picker: the file chosen, or the picker closed
      window.__picked = [];
      window.showSaveFilePicker = async (options) => {
        window.__picked.push(options.suggestedName);
        if (window.__cancel) throw new DOMException('closed', 'AbortError');
        return { name: 'Chosen.pdf', createWritable: async () => ({
          write: async (blob) => { window.__written = [...new Uint8Array(await blob.arrayBuffer())]; },
          close: async () => {},
        }) };
      };
    });
  });

  test('asks where first, then writes the copy there; Ctrl+Shift+S too', async ({ page, api }) => {
    seed(api);
    await openReader(page);
    await clickTool(page, saveAs(page));
    await expect.poll(() => page.evaluate(() => window.__written?.length ?? 0)).toBeGreaterThan(1000);
    expect(await page.evaluate(() => window.__picked)).toEqual(['Walden (with my marks).pdf']);
    const bytes = Uint8Array.from(await page.evaluate(() => window.__written));
    expect((await marksIn(bytes)).subtypes[2]).toEqual(['/FreeText']);
    await expect(page.getByText('Saved Chosen.pdf.')).toBeVisible();

    await page.evaluate(() => { window.__written = null; });
    await book(page).focus();
    await page.keyboard.press('Control+Shift+S');
    await expect.poll(() => page.evaluate(() => window.__written?.length ?? 0)).toBeGreaterThan(1000);
  });

  test('closing the picker saves nothing and says nothing', async ({ page, api }) => {
    seed(api);
    await openReader(page);
    await page.evaluate(() => { window.__cancel = true; });
    await clickTool(page, saveAs(page));
    await expect.poll(() => page.evaluate(() => window.__picked.length)).toBe(1);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__written ?? null)).toBeNull();
    await expect(page.getByText(/Saved/)).toHaveCount(0);
  });
});

// C40.4d: an EPUB reflows, so Save gives its highlights and comments as Markdown, chapter by chapter.
test.describe('an EPUB', () => {
  test.use({ book: 'epub' });
  test('Save gives its highlights and comments as Markdown, chapter by chapter; Ctrl+S too', async ({ page, api }) => {
    api.annotations.push({ id: 'e1', style: 'highlight', color: 'sage', orphaned: false, comment: 'The heart of it',
      anchors: [{ kind: 'epub', cfi: 'epubcfi(/6/4!/4/4,/1:0,/1:20)', text: 'The lamp on the desk' }],
      position_start: 1e6 + 10, position_end: 1e6 + 30, text_snapshot: 'The lamp on the desk' });
    api.annotations.push({ id: 'e2', style: 'underline', color: 'sky', orphaned: false, comment: null,
      anchors: [{ kind: 'epub', cfi: 'epubcfi(/6/6!/4/4,/1:0,/1:20)', text: 'a small circle of light' }],
      position_start: 2e6 + 40, position_end: 2e6 + 60, text_snapshot: 'a small circle of light' });
    await openReader(page);
    const downloaded = page.waitForEvent('download');
    await clickTool(page, save(page));
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('Walden (my highlights).md');
    const md = await readFile(await file.path(), 'utf8');
    expect(md).toContain('# Walden: my highlights');
    const blocks = md.split('## ').slice(1).map((block) => block.split('\n').filter(Boolean));
    expect(blocks[0].slice(0, 2)).toEqual(['Chapter 1', '> The lamp on the desk']);
    expect(blocks[0][2]).toMatch(/^Highlight \(Sage\)/); // and its page, once the pages are counted
    expect(blocks[0][3]).toBe('**Comment:** The heart of it');
    expect(blocks[1].slice(0, 2)).toEqual(['Chapter 2', '> a small circle of light']);
    expect(blocks[1][2]).toMatch(/^Underline \(Sky\)/);
    await expect(page.getByText('Saved your highlights: Walden (my highlights).md')).toBeVisible();

    await book(page).focus();
    const again = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    expect((await again).suggestedFilename()).toBe('Walden (my highlights).md');
  });
});
