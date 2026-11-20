// C34.2 (issue 12): a PDF opens without wasted reads. Its contents come from the stored outline (GET
// /books/{id}/open's book.toc) instead of resolving every outline entry in the browser, and the first page
// rendered is the saved place, not page 1 followed by a jump. C34.3 (issue 13): the file's signed URL comes with
// /open, so the reader does not ask /file for it. sample.pdf, mocked API.
import { contentsPane, expect, openReader, shown, test } from './fixtures.js';

test('the contents come from the stored outline when it has pages', async ({ page, api }) => {
  // Titles the PDF's own outline does not have ("Chapter 1 Signals", "Chapter 2 Noise"): they can only come from toc.
  api.toc = [{ title: 'Stored: the opening', page: 2, chunk_index: 0, block_id: '0.0' },
    { title: 'Stored: the noise', page: 5, chunk_index: 2, block_id: '2.0' }];
  await openReader(page);
  await page.getByRole('button', { name: 'Contents' }).click();
  const items = contentsPane(page).locator('.rf-contents-item');
  await expect(items).toHaveText(['Stored: the opening', 'Stored: the noise']);
  await items.nth(1).click();
  await expect.poll(() => shown(page)).toEqual({ start: '5', end: '5' }); // C38.2: page 5 at the top of the view
});

test('a book opens at its saved page without drawing page 1 first', async ({ page, api }) => {
  api.position = { anchor: { kind: 'pdf', page: 5, quads: [[0, 0, 1, 1]], text: '' } };
  await page.addInitScript(() => { // every PDF page put on screen, from the first render on
    window.__drawnPages = new Set();
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('.rf-pdf-page[data-page]')) window.__drawnPages.add(el.dataset.page);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-page'] });
  });
  await openReader(page);
  await expect.poll(() => shown(page)).toEqual({ start: '5', end: '5' });
  const drawn = await page.evaluate(() => [...window.__drawnPages]);
  expect(drawn).not.toContain('1');
});

test('the reader starts on the file with the URL /open gave, without asking /file', async ({ page, api }) => {
  await openReader(page);
  expect(api.fileLoads).toBe(1);
  expect(api.fileAsks).toBe(0);
});

test('from a server whose /open gives no URL, the reader asks /file once', async ({ page, api }) => {
  api.openFile = false;
  await openReader(page);
  expect(api.fileLoads).toBe(1);
  expect(api.fileAsks).toBe(1);
});
