// C37.8 (issue 26): what the notebook costs over a long book. A 300-page PDF (bigPdf.js, full pages of text) served
// the way Storage does; the frame rate while the notebook slides in, while a stroke is drawn on a page with the book
// blurred behind it, and while it closes, then the stroke again with the blur taken off (the control: what the
// static blur costs, the question of C37.8: keep it, or blur a snapshot instead), at 1x and 4x CPU; and the JS
// heap (CDP, after a collection) before, with the notebook open on a page, and after it closes. Runs in the
// frame-rate project (no trace recorder). Written to test-results/notebook-benchmarks.json, recorded in
// docs/BENCHMARKS.md. Mocked API.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, openReader } from './fixtures.js';
import { bigPdf, bigPdfLine } from './bigPdf.js';

const STORE = 'http://localhost:8000/e2e-storage/long.pdf';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const notebook = (page) => page.getByRole('dialog', { name: 'Notebook' });
const canvas = (page) => notebook(page).locator('canvas.interactive');

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

/** A freehand stroke, 60 moves over about 2 s, right of Excalidraw's properties panel. */
async function stroke(page, row) {
  const at = await canvas(page).boundingBox();
  const x = at.x + 340;
  const y = at.y + 140 + row * 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 60; i += 1) {
    await page.mouse.move(x + i * 6, y + Math.sin(i / 4) * 16);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function heapMb(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const of = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
  return { heapMb: +(of('JSHeapUsedSize') / 2 ** 20).toFixed(1), nodes: of('Nodes') };
}

const blur = (page, on) => page.evaluate((on) => {
  for (const el of document.querySelectorAll('.rf-reading-area, .rf-reading-chrome')) el.style.filter = on ? '' : 'none';
}, on);

test('notebook frame rate over a 300-page PDF (recorded in docs/BENCHMARKS.md)', async ({ page, api }, info) => {
  test.setTimeout(120_000);
  const file = bigPdf({ pages: 300, padBytes: 0, lines: 46 });
  await serve(page, api, file);
  await openReader(page);
  await expect(page.locator('.rf-pdf-page[data-page="1"] .textLayer')).toContainText(bigPdfLine(1), { timeout: 15_000 });
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const result = { date: new Date().toISOString(), browser: info.project.use.channel ?? 'chromium',
    book: { pages: 300, bytes: file.length }, viewport: page.viewportSize(), heap: { closed: await heapMb(cdp) } };

  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const run = {};
    run.open = await frames(page, async () => {
      await page.getByRole('button', { name: /^Notes/ }).click();
      await page.waitForTimeout(800);
    });
    if (rate === 1) {
      await notebook(page).getByRole('button', { name: 'New page' }).first().click();
      await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1500);
    }
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    run.drawBlurred = await frames(page, () => stroke(page, rate === 1 ? 0 : 2));
    await blur(page, false);
    await page.waitForTimeout(300);
    run.drawSharp = await frames(page, () => stroke(page, rate === 1 ? 1 : 3));
    await blur(page, true);
    if (rate === 1) result.heap.open = await heapMb(cdp);
    run.close = await frames(page, async () => {
      await notebook(page).getByRole('button', { name: 'Close notebook' }).click();
      await page.waitForTimeout(800);
    });
    await expect(notebook(page)).toHaveCount(0);
    result[`cpu${rate}x`] = run;
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.waitForTimeout(1000);
  result.heap.closedAgain = await heapMb(cdp);

  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/notebook-benchmarks.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  expect(result.cpu1x.drawBlurred.fps).toBeGreaterThan(30);
});
