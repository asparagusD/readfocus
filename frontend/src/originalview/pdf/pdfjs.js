// PDF.js, loaded only when a PDF opens (C17.2): the library and its worker are
// separate chunks that no other page imports. Fonts the PDF does not embed and
// the JPEG 2000 / JBIG2 image decoders (wasm) are served from our own origin
// under /pdfjs/ (vite.config.js, pdfjsAssets), so every image and glyph renders
// without a third-party request.

import { rangeSource } from './rangeSource';
import { recolourCanvas } from './recolour';

const ASSETS = '/pdfjs/';
export const RANGE_BYTES = 256 * 1024; // C35.4: each range PDF.js asks for (its own default is 64 KB)
let loading = null;
let worker = null;

/**
 * The pdfjs-dist module with its worker set; the same promise for every caller. C35.4 (issue 19): the one
 * PDF.js worker starts here, so its 1.3 MB script downloads while /open and the file's first bytes are on
 * their way, not after them, and every document (the reader's, a device book's text) shares it.
 */
export function loadPdfjs() {
  loading ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, script]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = script.default;
    worker = new pdfjs.PDFWorker({ name: 'readfocus-pdf' });
    return pdfjs;
  });
  return loading;
}

/**
 * Open `source` ({ url, renew? } or { data }) and resolve the PDFDocumentProxy. A URL is read
 * in byte ranges (C34.1, rangeSource.js); `renew` gives a fresh URL when the signed one expires.
 */
export async function openPdf(source) {
  const pdfjs = await loadPdfjs();
  const input = source.url
    ? await rangeSource(source.url, { Transport: pdfjs.PDFDataRangeTransport, renew: source.renew, chunk: RANGE_BYTES })
    : source;
  return pdfjs.getDocument({
    ...input,
    worker,
    rangeChunkSize: RANGE_BYTES,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    enableXfa: false,
  }).promise;
}

/**
 * Render page `pageNumber` of `doc` at `scale` CSS px per PDF point into a new canvas.
 * With `colours` ({ foreground, background }) the page is recoloured for lamplight,
 * images and coloured figures kept as published (recolour.js, C17.4).
 */
export async function renderPage(doc, pageNumber, scale, pixelRatio = globalThis.devicePixelRatio || 1, colours = null) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const transform = pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0];
  // Lamplight: a context with alpha, so text is antialiased in grey, not in LCD colour
  // fringes that the recolouring would take for coloured ink.
  const canvasContext = colours ? canvas.getContext('2d', { alpha: true, willReadFrequently: true }) : undefined;
  const task = page.render({ canvas, canvasContext, viewport, transform, recordImages: Boolean(colours) });
  const [, textContent] = await Promise.all([task.promise, page.getTextContent({ includeMarkedContent: true })]);
  // PDF.js 6 keeps the coordinates on the page (recorded on its first render, as fractions,
  // so they hold at every scale); the task's own getter stays empty.
  if (colours) recolourCanvas(canvas, page.imageCoordinates ?? task.imageCoordinates, colours);
  return { page, canvas, viewport, textContent };
}

/** The outline flattened to [{ title, page }] (1-based), in order; entries without a page are left out. */
export async function pdfOutline(doc) {
  const out = [];
  async function walk(items = []) {
    for (const item of items) {
      try {
        const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
        if (dest?.[0]) out.push({ title: item.title, page: (typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0])) + 1 });
      } catch { /* a broken destination: skip it */ }
      await walk(item.items);
    }
  }
  await walk((await doc.getOutline()) ?? []);
  return out;
}

/** Free a rendered page: the canvas's pixels and PDF.js's per-page objects. */
export function releasePage({ page, canvas }) {
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
  page.cleanup();
}
