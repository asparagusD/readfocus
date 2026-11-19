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

// C35.8c (issue 19): the shelf's next book, a stored PDF, is asked for one byte at its signed URL while the reader
// looks at the shelf, so the CDN has the file cached before it is opened; a second visit within ten minutes does not.
test('the next stored PDF is put in the CDN cache from the shelf, once', async ({ page, api }) => {
  api.shelf = [SHELVED];
  const STORE = 'http://localhost:8000/e2e-storage/warm.pdf';
  api.fileUrl = `${STORE}?token=t`;
  const warms = [];
  await page.route(`${STORE}**`, (route) => {
    const request = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    warms.push(request.headers().range);
    return route.fulfill({ status: 206, headers: { ...cors, 'Content-Range': 'bytes 0-0/9' }, body: '%' });
  });
  await page.goto('/');
  await expect.poll(() => warms).toEqual(['bytes=0-0']);
  expect(api.opens).toBe(0); // warming never opens the book
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await page.getByRole('link', { name: 'Library' }).first().click();
  await expect(page.locator('.rf-shelf__item')).toHaveCount(1);
  expect(warms).toEqual(['bytes=0-0']);
});
