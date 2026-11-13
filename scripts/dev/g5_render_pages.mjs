// Gate G5 (C18.G): render shelf PDF pages with PDF.js in Edge, as the original view does
// (pdfjs-dist from frontend/node_modules, the same standard fonts and wasm decoders), and
// save each as a PNG for scripts/dev/g5_page_diff.py to compare with a PDFium render.
// Local files only: the page is served from a made-up origin by Playwright's router.
//
//   node scripts/dev/g5_render_pages.mjs <out dir> <scale> <book.pdf:page> [...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'frontend', 'package.json'));
const { chromium } = require('playwright');
const PDFJS = path.dirname(require.resolve('pdfjs-dist/package.json'));
const ORIGIN = 'http://g5.local';
const TYPES = { '.mjs': 'text/javascript', '.pdf': 'application/pdf', '.html': 'text/html', '.wasm': 'application/wasm' };

const [out, scale, ...pages] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
await page.route(`${ORIGIN}/**`, (route) => {
  const url = new URL(route.request().url());
  const file = url.pathname === '/' ? null
    : url.pathname.startsWith('/pdfjs/') ? path.join(PDFJS, url.pathname.slice('/pdfjs/'.length))
      : path.join(ROOT, 'samples', 'technical', url.pathname.slice(1));
  if (!file) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
});
await page.goto(`${ORIGIN}/`);
for (const spec of pages) {
  const [book, number] = spec.split(':');
  const png = await page.evaluate(async ({ book, number, scale }) => {
    const pdfjs = await import('/pdfjs/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ url: `/${book}`, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' }).promise;
    const p = await doc.getPage(Number(number));
    const viewport = p.getViewport({ scale: Number(scale) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await p.render({ canvas, viewport }).promise;
    await doc.loadingTask?.destroy?.();
    return canvas.toDataURL('image/png');
  }, { book, number, scale });
  const name = `${path.parse(book).name}-p${number}-pdfjs.png`;
  writeFileSync(path.join(out, name), Buffer.from(png.split(',')[1], 'base64'));
  console.log(name);
}
await browser.close();
