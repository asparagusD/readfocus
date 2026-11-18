// C34.2 (issue 12): a PDF opens without wasted reads. Its contents come from the stored outline (GET
// /books/{id}/open's book.toc) instead of resolving every outline entry in the browser, and the first page
// rendered is the saved place, not page 1 followed by a jump. sample.pdf, mocked API.
import { test, expect, openReader, shown } from './fixtures.js';

test('the contents come from the stored outline when it has pages', async ({ page, api }) => {
  // Titles the PDF's own outline does not have ("Chapter 1 Signals", "Chapter 2 Noise"): they can only come from toc.
  api.toc = [{ title: 'Stored: the opening', page: 2, chunk_index: 0, block_id: '0.0' },
    { title: 'Stored: the noise', page: 5, chunk_index: 2, block_id: '2.0' }];
  await openReader(page);
  await page.getByRole('button', { name: 'Contents' }).click();
  const items = page.getByRole('dialog', { name: 'Contents' }).locator('.rf-contents-item');
  await expect(items).toHaveText(['Stored: the opening', 'Stored: the noise']);
  await items.nth(1).click();
  await expect.poll(() => shown(page)).toEqual({ start: '4', end: '5' }); // page 5 on the 4-5 spread
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
  await expect.poll(() => shown(page)).toEqual({ start: '4', end: '5' });
  const drawn = await page.evaluate(() => [...window.__drawnPages]);
  expect(drawn).not.toContain('1');
});
