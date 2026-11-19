// C34.1 (issue 11): a PDF in cloud storage is read in byte ranges. Supabase Storage answers `Range` with 206 but
// sends no Accept-Ranges, so PDF.js given the URL used to download the whole file before the first page. Here the
// book's file is a generated 5 MB PDF (bigPdf.js: a few pages behind 5 MB of padding) served the way Storage does:
// 206 for a range, no Accept-Ranges. The page shows after a small part of the file. Mocked API.
import { test, expect, openReader } from './fixtures.js';
import { bigPdf, bigPdfLine } from './bigPdf.js';

// On the mocked API's host: the app's CSP allows only it and the Supabase project.
const STORE = 'http://localhost:8000/e2e-storage/big.pdf';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

test('a stored PDF opens after reading only a few of its bytes', async ({ page, api }) => {
  const file = bigPdf({ pages: 6, padBytes: 5 * 1024 * 1024 });
  const served = { bytes: 0, ranges: [], whole: 0 };
  api.fileUrl = `${STORE}?token=t`; // the signed URL /open (and /file) give
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

// C35.8b (issue 19): a PDF that is not linearized (bigPdf's, like the user's thesis) keeps its cross-reference table
// at its end, which PDF.js reads before any page. That last range is asked for beside the first bytes, before they
// have even arrived (their answer is held back here), and only once.
test('the last range of a stored PDF is read beside its first bytes, once', async ({ page, api }) => {
  const file = bigPdf({ pages: 6, padBytes: 5 * 1024 * 1024 });
  const tailBegin = Math.floor((file.length - 1) / (256 * 1024)) * 256 * 1024; // PDF.js's last 256 KB chunk
  const ranges = [];
  let firstAnswered = false;
  let tailAskedBeforeFirstAnswered = false;
  api.fileUrl = `${STORE}?token=t`;
  await page.route(`${STORE}**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const headers = { ...CORS, 'Content-Type': 'application/pdf' };
    if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'Content-Length': String(file.length) } });
    const match = /bytes=(\d+)-(\d+)/.exec(request.headers().range ?? '');
    const [begin, last] = [Number(match[1]), Math.min(Number(match[2]), file.length - 1)];
    ranges.push([begin, last]);
    if (begin === tailBegin && !firstAnswered) tailAskedBeforeFirstAnswered = true;
    if (begin === 0) {
      await new Promise((resolve) => setTimeout(resolve, 400)); // a slow first answer
      firstAnswered = true;
    }
    return route.fulfill({ status: 206, headers: { ...headers, 'Content-Range': `bytes ${begin}-${last}/${file.length}` },
      body: file.subarray(begin, last + 1) });
  });

  await openReader(page);
  await expect(page.locator('.rf-pdf-page[data-page="1"] .textLayer')).toContainText(bigPdfLine(1), { timeout: 15_000 });
  expect(tailAskedBeforeFirstAnswered).toBe(true);
  expect(ranges.filter(([, last]) => last === file.length - 1)).toEqual([[tailBegin, file.length - 1]]);
});
