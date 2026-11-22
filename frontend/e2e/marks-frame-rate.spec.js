// C39.9 (issue 23): what Edge's markup costs while reading. The 300-page PDF of C38.10's bench with marks on every
// page: four ink strokes of 150 points and a text box (1,500 marks), and a highlight on each page with a comment on
// every tenth. The frame rate while the wheel scrolls through it and Page Down steps it, at 1x and 4x CPU; how many
// strokes are in the page at once (only the pages drawn have theirs); how many 20-page blocks of marks were asked for;
// the JS heap when it opens, after scrolling and at its end. Runs in the frame-rate project (no trace recorder).
// Written to test-results/marks-benchmarks.json, recorded in docs/BENCHMARKS.md. Mocked API.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, book, openReader } from './fixtures.js';
import { bigPdf, bigPdfLine } from './bigPdf.js';

const STORE = 'http://localhost:8000/e2e-storage/marks.pdf';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

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

async function wheel(page, ticks) {
  const box = await page.locator('.rf-pdf-book').boundingBox();
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

/** Marks on every page: four strokes of 150 points across the page, a text box; a highlight, a comment on every 10th. */
function seed(api) {
  for (let page = 1; page <= 300; page += 1) {
    for (let s = 0; s < 4; s += 1) {
      const points = Array.from({ length: 150 }, (_, i) => [72 + i * 3, 200 + s * 120 + 12 * Math.sin(i / 6), 0.5]);
      api.marks.push({ id: `mark-${page}-${s}`, kind: 'ink', page, color: 'ocean', data: { points, width: 2 } });
    }
    api.marks.push({ id: `mark-${page}-t`, kind: 'text', page, color: 'ink',
      data: { x: 300, y: 680, width: 240, text: `A note on page ${page}, over two lines of the book.`, size: 12 } });
    api.annotations.push({ id: `ann-${page}`, style: 'highlight', color: 'honey', orphaned: false,
      anchors: [{ kind: 'pdf', page, quads: [[72, 72, 300, 86]], text: bigPdfLine(page) }],
      position_start: page * 1e6 + 7200, position_end: page * 1e6 + 8600, text_snapshot: bigPdfLine(page),
      comment: page % 10 === 0 ? `Comment on page ${page}` : null });
  }
}

const count = (page, selector) => page.locator(selector).count();

test('marks frame rate and memory over a 300-page PDF with marks on every page (recorded in docs/BENCHMARKS.md)', async ({ page, api }, info) => {
  test.setTimeout(240_000);
  seed(api);
  const file = bigPdf({ pages: 300, padBytes: 0, lines: 46 });
  await serve(page, api, file);
  await openReader(page);
  await expect(page.locator('.rf-pdf-page[data-page="1"] .textLayer')).toContainText(bigPdfLine(1), { timeout: 15_000 });
  await expect(page.locator('.rf-pdf-page[data-page="1"] .rf-ink path')).toHaveCount(4, { timeout: 10_000 });
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const result = { date: new Date().toISOString(), browser: info.project.use.channel ?? 'chromium',
    book: { pages: 300, bytes: file.length, marks: api.marks.length, highlights: api.annotations.length },
    viewport: page.viewportSize(), heap: { opened: await heapMb(cdp) }, inPage: {} };
  result.inPage.opened = { strokes: await count(page, '.rf-ink path'), boxes: await count(page, '.rf-textbox') };

  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const run = {};
    run.wheel = await frames(page, () => wheel(page, 180)); // about 20 pages at fit-page
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
  result.place = await page.getByRole('textbox', { name: /^Page number/ }).inputValue();
  result.inPage.after60 = { strokes: await count(page, '.rf-ink path'), boxes: await count(page, '.rf-textbox'),
    commentIcons: await count(page, '.rf-comment-marker') };
  result.heap.after60 = await heapMb(cdp);
  await book(page).focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(2500);
  result.inPage.atEnd = { strokes: await count(page, '.rf-ink path'), boxes: await count(page, '.rf-textbox') };
  result.heap.atEnd = await heapMb(cdp);
  result.blocksLoaded = api.markLoads.length;
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/marks-benchmarks.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  expect(result.cpu1x.wheel.fps).toBeGreaterThan(30);
  expect(result.inPage.after60.strokes).toBeLessThanOrEqual(7 * 4); // only the pages drawn carry theirs
});
