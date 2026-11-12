// PDF.js, loaded only when a PDF opens (C17.2): the library and its worker are
// separate chunks that no other page imports. Fonts the PDF does not embed and
// the JPEG 2000 / JBIG2 image decoders (wasm) are served from our own origin
// under /pdfjs/ (vite.config.js, pdfjsAssets), so every image and glyph renders
// without a third-party request.

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

/** Render page `pageNumber` of `doc` at `scale` CSS px per PDF point into a new canvas. */
export async function renderPage(doc, pageNumber, scale, pixelRatio = globalThis.devicePixelRatio || 1) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const transform = pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0];
  const [, textContent] = await Promise.all([
    page.render({ canvas, viewport, transform }).promise,
    page.getTextContent({ includeMarkedContent: true }),
  ]);
  return { page, canvas, viewport, textContent };
}

/** Free a rendered page: the canvas's pixels and PDF.js's per-page objects. */
export function releasePage({ page, canvas }) {
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
  page.cleanup();
}
