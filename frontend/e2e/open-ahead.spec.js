// C35.4 (issue 19): a book starts opening before the reader's page has loaded. Pointing at a PDF on the shelf
// loads the reader and PDF.js with its one worker, asking the server nothing; clicking it starts /open, which the
// reader then uses instead of asking again. The worker's script is fetched once. sample.pdf, mocked API.
import { test, expect, BOOK } from './fixtures.js';

test.use({ book: 'pdf' });

const SHELVED = { id: BOOK, title: 'Walden', author: 'Henry David Thoreau', status: 'ready', file_type: 'pdf',
  total_chunks: 3, total_words: 900, created_at: '2026-11-01T00:00:00Z', cover_url: null, storage_mode: 'cloud',
  progress: null };

test('pointing at a PDF warms the reader without opening it; a click opens it once', async ({ page, api }) => {
  api.shelf = [SHELVED];
  const workers = [];
  page.on('request', (request) => { if (/pdf\.worker\.min-[^/]*\.mjs/.test(request.url())) workers.push(request.url()); });
  await page.goto('/');
  const tile = page.locator('.rf-shelf__book').first();
  await tile.hover();
  await expect.poll(() => workers.length).toBe(1); // the worker starts on hover, before any click
  expect(api.opens).toBe(0); // pointing never opens a book (/open makes it "begun", C32)
  await tile.click();
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor({ timeout: 15_000 });
  expect(api.opens).toBe(1); // the reader took the click's /open
  expect(workers.length).toBe(1);
});

test('a PDF opened straight from its address downloads the worker once', async ({ page }) => {
  const workers = [];
  page.on('request', (request) => { if (/pdf\.worker\.min/.test(request.url())) workers.push(request.url()); });
  await page.goto(`/read/${BOOK}`);
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor({ timeout: 15_000 });
  expect(workers.filter((url) => url.endsWith('.mjs'))).toHaveLength(1);
});
