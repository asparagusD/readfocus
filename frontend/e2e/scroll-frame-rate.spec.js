// C38.10 (issue 22): what scrolling costs, as Edge reads, replacing the page-turn bench (C12.10). A 300-page PDF
// (bigPdf.js, full pages of text) served the way Storage does: the frame rate while the wheel scrolls through it and
// while Page Down steps a page at a time, at 1x and 4x CPU; how many pages are drawn at once (the ±2 page cache);
// and the JS heap (CDP, after a collection) when it opens, after 60 pages scrolled, and at its end. Then the EPUB
// fixture scrolled by the wheel through its sections. Runs in the frame-rate project (no trace recorder). Written to
// test-results/scroll-benchmarks-*.json, recorded in docs/BENCHMARKS.md. Mocked API.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, book, openReader } from './fixtures.js';
import { bigPdf, bigPdfLine } from './bigPdf.js';

const STORE = 'http://localhost:8000/e2e-storage/scroll.pdf';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

/** The PDF served like Storage: 206 for a range, no Accept-Ranges. */
async function serve(page, api, file) {
  api.fileUrl = `${STORE}?token=t`;
  await page.route(`${STORE}**`, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const headers = { ...CORS, 'Content-Type': 'application/pdf' };
    if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'Content-Length': String(file.length) } });
    const match = /bytes=(\d+)-(\d+)/.exec(request.headers().range ?? '');
    if (!match) return route.fulfill({ status: 200, headers, body: file });
    const [begin, last] = [Number(match[1]), Math.min(Number(match[2]), file.length - 1)];
    return route.fulfill({ status: 206, headers: { ...headers, 'Content-Range': `bytes ${begin}-${last}/${file.length}` },
      body: file.subarray(begin, last + 1) });
  });
}

/** Frame times from requestAnimationFrame while `act` runs. */
async function frames(page, act) {
  await page.evaluate(() => {
    window.rfFrames = [];
    const tick = (t) => { window.rfFrames.push(t); window.rfRaf = requestAnimationFrame(tick); };
    window.rfRaf = requestAnimationFrame(tick);
  });
  await act();
  const times = await page.evaluate(() => { cancelAnimationFrame(window.rfRaf); return window.rfFrames; });
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const seconds = (times.at(-1) - times[0]) / 1000;
  return { frames: times.length, fps: +(gaps.length / seconds).toFixed(1), worstFrameMs: +Math.max(...gaps).toFixed(1),
    over33ms: gaps.filter((g) => g > 33.4).length };
}

/** The wheel, `ticks` notches of 100 px a frame apart, over the middle of `area`. */
async function wheel(page, area, ticks) {
  const box = await page.locator(area).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < ticks; i += 1) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(16);
  }
}

async function heapMb(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const of = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
  return { heapMb: +(of('JSHeapUsedSize') / 2 ** 20).toFixed(1), nodes: of('Nodes') };
}

const drawn = (page) => page.locator('.rf-pdf-page canvas').count();
const write = (name, result) => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/scroll-benchmarks-${name}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
};

test('scroll frame rate and memory over a 300-page PDF (recorded in docs/BENCHMARKS.md)', async ({ page, api }, info) => {
  test.setTimeout(180_000);
  const file = bigPdf({ pages: 300, padBytes: 0, lines: 46 });
  await serve(page, api, file);
  await openReader(page);
  await expect(page.locator('.rf-pdf-page[data-page="1"] .textLayer')).toContainText(bigPdfLine(1), { timeout: 15_000 });
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const result = { date: new Date().toISOString(), browser: info.project.use.channel ?? 'chromium',
    book: { pages: 300, bytes: file.length }, viewport: page.viewportSize(), heap: { opened: await heapMb(cdp) }, drawn: {} };

  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const run = {};
    run.wheel = await frames(page, () => wheel(page, '.rf-pdf-book', 180)); // about 20 pages at fit-page
    await book(page).focus();
    run.pageDown = await frames(page, async () => {
      for (let i = 0; i < 10; i += 1) {
        await page.keyboard.press('PageDown');
        await page.waitForTimeout(150);
      }
    });
    result[`cpu${rate}x`] = run;
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.waitForTimeout(1500);
  result.drawn.after60 = await drawn(page);
  result.place = await page.getByRole('textbox', { name: /^Page number/ }).inputValue();
  result.heap.after60 = await heapMb(cdp);
  await book(page).focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(2000);
  result.drawn.atEnd = await drawn(page);
  result.heap.atEnd = await heapMb(cdp);
  write('pdf', result);
  expect(result.cpu1x.wheel.fps).toBeGreaterThan(30);
  expect(result.drawn.after60).toBeLessThanOrEqual(7); // the pages in view and two either side
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test('scroll frame rate through an EPUB\'s sections (recorded in docs/BENCHMARKS.md)', async ({ page }, info) => {
    await openReader(page);
    const run = await frames(page, () => wheel(page, '.rf-epub', 120));
    const result = { date: new Date().toISOString(), browser: info.project.use.channel ?? 'chromium', book: 'epub',
      place: await page.locator('.rf-ov').getAttribute('data-start'), wheel: run };
    write('epub', result);
    expect(run.fps).toBeGreaterThan(30);
  });
});
