/**
 * A text layer for scanned PDF pages (C19.4), read in this browser with tesseract.js (Apache-2.0),
 * English only. tesseract runs in its own Web Worker; it, its core and the English model are served
 * from our own origin (/ocr/, copied from node_modules at build by scripts/copy-ocr.mjs) and loaded
 * only when a scanned page is first read. A page is drawn with PDF.js at about 300 dpi, its math,
 * code, table and figure boxes painted white so they are never read, recognised, and its words
 * (boxes in PDF points from the top-left, ANCHORS A1) posted to POST /books/{id}/ocr, where they are
 * cleaned and stored. The server is the cache: a page with stored words is fetched, never read again;
 * a page is read at most once per book while this source lives, one page at a time.
 */

export const OCR_DPI = 300;
export const OCR_MAX_PX = 2400; // the longer side of the drawn page, so a big page stays in memory on a phone
export const FULL_PAGE = 0.8; // a box over this share of the page is the scan itself, not a figure (as the server)
const BATCH = 20; // GET /books/{id}/ocr serves at most 20 pages of words at a time

/** CSS px per PDF point for reading a page of `width` x `height` points. */
export const ocrScale = (width, height) => Math.min(OCR_DPI / 72, OCR_MAX_PX / Math.max(width, height));

/** The region boxes to paint out before reading: all but those covering most of the page (the scan). */
export const skipBoxes = (boxes, width, height) => (boxes ?? [])
  .filter(([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0) < FULL_PAGE * width * height);

const round = (v) => Math.round(v * 100) / 100;

/** tesseract's blocks (paragraphs, lines, words; boxes in drawn px) as POST words: {t, b, c, p, l}. */
export function toPayload(blocks, scale) {
  const out = [];
  let paragraph = 0;
  let line = 0;
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      let used = false;
      for (const row of para.lines ?? []) {
        const words = (row.words ?? []).filter((w) => w.text?.trim());
        for (const w of words) {
          const { x0, y0, x1, y1 } = w.bbox;
          out.push({ t: w.text.trim(), b: [x0, y0, x1, y1].map((v) => round(v / scale)), c: round(w.confidence ?? 0), p: paragraph, l: line });
        }
        if (words.length) { line += 1; used = true; }
      }
      if (used) paragraph += 1;
    }
  }
  return out;
}

/** Stored words (boxes in points) as absolutely placed spans in CSS px; words of one line get a space between. */
export function spansFor(words, scale) {
  return (words ?? []).map((w, i) => {
    const [x0, y0, x1, y1] = w.b;
    const next = words[i + 1];
    const sameLine = next && next.b[0] >= x1 - 1 && (next.b[1] + next.b[3]) / 2 >= y0 && (next.b[1] + next.b[3]) / 2 <= y1;
    return {
      text: sameLine ? `${w.t} ` : w.t,
      left: round(x0 * scale), top: round(y0 * scale),
      width: round(((sameLine ? next.b[0] : x1) - x0) * scale), height: round((y1 - y0) * scale),
    };
  });
}

const assetUrl = (path) => new URL(`${import.meta.env?.BASE_URL ?? '/'}ocr/${path}`, globalThis.location?.origin).href;

let engine = null; // one tesseract worker for the app, made on first use
function tesseract() {
  engine ??= import('tesseract.js').then(({ createWorker }) => createWorker('eng', 1, {
    workerPath: assetUrl('worker.min.js'), corePath: assetUrl('core'), langPath: assetUrl('lang'),
    workerBlobURL: false, gzip: true,
  })).catch((error) => { engine = null; throw error; });
  return engine;
}

/**
 * The OCR source for one book. `api` is fetchApi; `skipFor(page)` gives the page's region boxes
 * (pdf/regions.js); `ahead` reads every scanned page in turn once the PDF is attached (a fully
 * scanned book opened pages-only, which needs them all for its first session); `recognise` stands
 * in for tesseract in tests.
 */
export function createOcrSource(api, bookId, { skipFor = async () => [], ahead = false, recognise = null } = {}) {
  const words = new Map(); // page -> stored words
  const reading = new Map(); // page -> promise
  const batches = new Map();
  const listeners = new Set();
  let doc = null;
  let queue = Promise.resolve();
  let progress = { scanned: [], done: [], reingest: false };
  const info = api(`/books/${bookId}/ocr`)
    .then(({ scanned_pages: scanned = [], done = [] } = {}) => { progress = { ...progress, scanned, done }; return progress; })
    .catch(() => progress);
  const tell = () => listeners.forEach((fn) => fn(progress));

  function load(page) {
    const first = Math.floor((page - 1) / BATCH) * BATCH + 1;
    if (!batches.has(first)) {
      batches.set(first, api(`/books/${bookId}/ocr?first=${first}&last=${first + BATCH - 1}`)
        .then(({ pages = [] } = {}) => pages.forEach((p) => words.set(p.page, p.words)))
        .catch(() => { batches.delete(first); }));
    }
    return batches.get(first);
  }

  async function read(page) {
    const pdfPage = await doc.getPage(page);
    const { width, height } = pdfPage.getViewport({ scale: 1 });
    const scale = ocrScale(width, height);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    context.fillStyle = '#fff';
    for (const [x0, y0, x1, y1] of skipBoxes(await skipFor(page), width, height)) {
      context.fillRect(x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
    }
    const started = performance.now();
    const blocks = recognise ? await recognise(canvas) : (await (await tesseract()).recognize(canvas, {}, { blocks: true })).data.blocks;
    const seconds = (performance.now() - started) / 1000;
    canvas.width = 0; // hand the pixels back
    const sent = await api(`/books/${bookId}/ocr`, {
      method: 'POST',
      body: JSON.stringify({ page, width, height, engine: 'tesseract.js 7.0.0 eng', words: toPayload(blocks, scale) }),
    });
    batches.clear(); // the stored, cleaned words are fetched again
    await load(page);
    progress = { ...progress, done: [...new Set([...progress.done, page])], reingest: progress.reingest || Boolean(sent?.reingest), seconds };
    tell();
    return words.get(page) ?? [];
  }

  /** The page's words, read once if they are not stored yet; [] for a page with its own text. */
  async function wordsFor(page) {
    await info;
    if (!progress.scanned.includes(page)) return [];
    if (!words.has(page) && progress.done.includes(page)) await load(page);
    if (words.has(page)) return words.get(page);
    if (!doc) return [];
    if (!reading.has(page)) {
      const next = queue.then(() => read(page));
      queue = next.catch(() => {});
      reading.set(page, next.finally(() => reading.delete(page)));
    }
    return reading.get(page);
  }

  return {
    ready: () => info,
    isScanned: (page) => progress.scanned.includes(page),
    has: (page) => words.has(page) || progress.done.includes(page),
    wordsFor,
    progress: () => progress,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Give the source the open PDF; with `ahead`, every scanned page is then read in order. */
    attach(pdf) {
      doc = pdf;
      if (ahead) info.then(() => progress.scanned.filter((p) => !progress.done.includes(p))
        .reduce((chain, page) => chain.then(() => wordsFor(page)).catch(() => {}), Promise.resolve()));
    },
  };
}
