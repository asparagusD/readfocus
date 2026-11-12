// PDF.js, loaded only when a PDF opens (C17.2): the library and its worker are
// separate chunks that no other page imports. Fonts the PDF does not embed and
// the JPEG 2000 / JBIG2 image decoders (wasm) are served from our own origin
// under /pdfjs/ (vite.config.js, pdfjsAssets), so every image and glyph renders
// without a third-party request.

import { recolourCanvas } from './recolour';

const ASSETS = '/pdfjs/';
let loading = null;

/** The pdfjs-dist module with its worker set; the same promise for every caller. */
export function loadPdfjs() {
  loading ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return loading;
}

/** Open `source` ({ url } or { data }) and resolve the PDFDocumentProxy. */
export async function openPdf(source) {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({
    ...source,
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
