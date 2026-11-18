// C34.1 (issue 11): a PDF in cloud storage is read in byte ranges. Supabase Storage answers `Range` with 206 but
// sends no Accept-Ranges, so PDF.js given the URL used to download the whole file before the first page. Here the
// book's file is a generated 5 MB PDF (bigPdf.js: a few pages behind 5 MB of padding) served the way Storage does:
// 206 for a range, no Accept-Ranges. The page shows after a small part of the file. Mocked API.
import { test, expect, BOOK, openReader } from './fixtures.js';
import { bigPdf, bigPdfLine } from './bigPdf.js';

// On the mocked API's host: the app's CSP allows only it and the Supabase project.
const STORE = 'http://localhost:8000/e2e-storage/big.pdf';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

test('a stored PDF opens after reading only a few of its bytes', async ({ page }) => {
  const file = bigPdf({ pages: 6, padBytes: 5 * 1024 * 1024 });
  const served = { bytes: 0, ranges: [], whole: 0 };
  await page.route(`http://localhost:8000/books/${BOOK}/file`, (route) => route.fulfill({
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${STORE}?token=t`, expires_in: 300 }),
  }));
  await page.route(`${STORE}**`, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const headers = { ...CORS, 'Content-Type': 'application/pdf' }; // like Storage: no Accept-Ranges
    if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'Content-Length': String(file.length) } });
    const match = /bytes=(\d+)-(\d+)/.exec(request.headers().range ?? '');
    if (!match) {
      served.whole += 1;
      served.bytes += file.length;
      return route.fulfill({ status: 200, headers, body: file });
    }
    const [begin, last] = [Number(match[1]), Math.min(Number(match[2]), file.length - 1)];
    served.ranges.push([begin, last]);
    served.bytes += last - begin + 1;
    return route.fulfill({ status: 206, headers: { ...headers, 'Content-Range': `bytes ${begin}-${last}/${file.length}` },
      body: file.subarray(begin, last + 1) });
  });

  await openReader(page);
  await expect(page.locator('.rf-pdf-page[data-page="1"] .textLayer')).toContainText(bigPdfLine(1), { timeout: 15_000 });
  expect(served.whole).toBe(0);
  expect(served.ranges.length).toBeGreaterThan(1);
  expect(served.bytes).toBeLessThan(file.length / 10); // about 200 KB of 5 MB
});
