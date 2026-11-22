// C40.7 (issue 24): read aloud and Save on C39.9's marked book (a 300-page PDF from bigPdf.js, 1,500 marks: four
// 150-point strokes and a text box a page; 300 highlights, a comment on every tenth). Read aloud: a fake voice speaks
// a word every 5 ms while the view follows it; the frame rate at 1x and 4x CPU, the pages it read on into, the JS
// heap. Save: click to download, the frames the page drew meanwhile (pdf-lib works in a worker since C40.8), the page's
// heap peak (the worker's own is not counted) and the copy's size. Results in test-results/read-aloud-save-benchmarks.json (recorded in docs/BENCHMARKS.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { test, expect, openReader, clickTool } from './fixtures.js';
import { bigPdf, bigPdfLine } from './bigPdf.js';

const STORE = 'http://localhost:8000/e2e-storage/marks.pdf';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const results = {};

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

/** A voice that speaks a word every window.__wordMs, as read-aloud.spec.js's. */
const fakeVoice = () => {
  window.__wordMs = 5;
  window.__spoken = 0;
  let current = null;
  let timer = null;
  const synth = new EventTarget();
  Object.assign(synth, {
    getVoices: () => [{ name: 'Bench voice', lang: 'en-US', voiceURI: 'bench', default: true, localService: true }],
    speak(u) {
      window.__spoken += 1;
      current = u;
      const words = [...u.text.matchAll(/\S+/g)];
      let i = 0;
      const step = () => {
        if (current !== u) return;
        if (i < words.length) {
          const w = words[i];
          i += 1;
          u.onboundary?.({ name: 'word', charIndex: w.index, charLength: w[0].length });
          timer = setTimeout(step, window.__wordMs);
        } else { current = null; u.onend?.({}); }
      };
      timer = setTimeout(step, 0);
    },
    cancel() { const u = current; current = null; clearTimeout(timer); u?.onerror?.({ error: 'interrupted' }); },
    pause() {},
    resume() {},
  });
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
};

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

async function heapMb(cdp, collect = true) {
  if (collect) await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  return +(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 2 ** 20).toFixed(1);
}

async function open(page, api) {
  seed(api);
  const file = bigPdf({ pages: 300, padBytes: 0, lines: 46 });
  await serve(page, api, file);
  await openReader(page);
  await expect(page.locator('.rf-pdf-page[data-page="1"] .textLayer')).toContainText(bigPdfLine(1), { timeout: 15_000 });
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  return { file, cdp };
}

function record(info, key, value) {
  results[key] = { date: new Date().toISOString(), browser: info.project.use.channel ?? 'chromium', ...value };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/read-aloud-save-benchmarks.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ [key]: results[key] }));
}

test('read aloud frame rate while the view follows the words through a marked 300-page PDF', async ({ page, api }, info) => {
  test.setTimeout(180_000);
  await page.addInitScript(fakeVoice);
  const { cdp } = await open(page, api);
  const out = { heap: { opened: await heapMb(cdp) } };
  await clickTool(page, page.getByRole('button', { name: 'Read aloud', exact: true }));
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    out[`cpu${rate}x`] = await frames(page, () => page.waitForTimeout(8000));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  out.page = Number(await page.getByRole('textbox', { name: /^Page number/ }).inputValue());
  out.utterances = await page.evaluate(() => window.__spoken);
  out.heap.reading = await heapMb(cdp);
  await page.getByRole('region', { name: 'Read aloud' }).getByRole('button', { name: 'Stop reading aloud' }).click();
  record(info, 'readAloud', out);
  expect(out.page).toBeGreaterThan(1); // it read on, and the view went with it
  expect(out.cpu1x.fps).toBeGreaterThan(30);
});

test('save frame rate, time and heap for a copy of a marked 300-page PDF', async ({ page, api }, info) => {
  test.setTimeout(180_000);
  const { file, cdp } = await open(page, api);
  const out = { book: { pages: 300, bytes: file.length, marks: api.marks.length, highlights: api.annotations.length } };
  out.heap = { before: await heapMb(cdp) };
  let peak = out.heap.before;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, await heapMb(cdp, false));
      await page.waitForTimeout(50);
    }
  })();
  let file2;
  const started = Date.now();
  out.frames = await frames(page, async () => {
    const downloaded = page.waitForEvent('download', { timeout: 120_000 });
    await clickTool(page, page.getByRole('button', { name: 'Save', exact: true }));
    file2 = await downloaded;
  });
  out.saveMs = Date.now() - started;
  sampling = false;
  await sampler;
  out.heap.peak = peak;
  out.heap.after = await heapMb(cdp);
  out.copyBytes = (await stat(await file2.path())).size;
  record(info, 'save', out);
  expect(out.copyBytes).toBeGreaterThan(file.length);
});
