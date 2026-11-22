// Print (C40.5, issue 24: Edge's Print). A PDF prints the copy with my marks from a hidden frame; an EPUB prints the
// chapter on screen; Ctrl+P prints the book, not the app's page. The print dialog is faked: `print` in every frame
// records which document asked (window.top.__printed) and opens nothing.
import { PDFDocument, PDFName } from 'pdf-lib';
import { test, expect, openReader, clickTool, book } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      const top = window.top;
      top.__printed = [...(top.__printed ?? []), window === top ? 'page' : document.contentType];
    };
  });
});

const printed = (page) => page.evaluate(() => window.__printed ?? []);
const print = (page) => page.getByRole('button', { name: 'Print', exact: true });

test.describe('a PDF', () => {
  test.use({ book: 'pdf' });

  test('Print prints the copy with my marks from a hidden frame; Ctrl+P too, never the app page', async ({ page, api }) => {
    api.annotations.push({ id: 'ann-1', style: 'highlight', color: 'honey', orphaned: false, comment: null,
      anchors: [{ kind: 'pdf', page: 1, quads: [[72, 120, 300, 134]], text: 'the lamp threw' }],
      position_start: 1e6 + 12000, position_end: 1e6 + 13400, text_snapshot: 'the lamp threw' });
    await openReader(page);
    await clickTool(page, print(page));
    await expect.poll(() => printed(page)).toEqual(['application/pdf']);
    const bytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch(document.querySelector('iframe[data-rf-print]').src)).arrayBuffer())]);
    const pdf = await PDFDocument.load(Uint8Array.from(bytes));
    const first = pdf.getPages()[0].node.Annots().asArray().map((ref) => pdf.context.lookup(ref).get(PDFName.of('Subtype')).toString());
    expect(first).toEqual(['/Highlight']);

    await book(page).focus();
    await page.keyboard.press('Control+p');
    await expect.poll(() => printed(page)).toEqual(['application/pdf', 'application/pdf']);
    await expect(page.locator('iframe[data-rf-print]')).toHaveCount(2); // each stays a minute for the dialog
  });
});

test.describe('an EPUB', () => {
  test.use({ book: 'epub' });

  test('Print prints the chapter on screen; Ctrl+P too', async ({ page }) => {
    await openReader(page);
    await clickTool(page, print(page));
    await expect.poll(() => printed(page)).toEqual(['application/xhtml+xml']);
    await book(page).focus();
    await page.keyboard.press('Control+p');
    await expect.poll(() => printed(page)).toEqual(['application/xhtml+xml', 'application/xhtml+xml']);
  });
});
