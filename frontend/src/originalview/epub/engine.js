// The one door to foliate-js (C17.3; decision D-C17.3). Everything foliate does
// for us is reached through openEpub, so a change in its unstable API is a
// change in this file only. The vendored code loads lazily, with this module.
import loraUrl from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url';
import { BOOK_CSS, sanitizeSection } from './sanitize';
import { cleanCss } from './urls';

export const SPREAD_MIN_WIDTH = 1024; // two pages side by side from here up (as the C12 reader)
const DOCUMENT_TYPES = new Set(['application/xhtml+xml', 'text/html', 'image/svg+xml']);

/** The extra CSS for a style mode: the publisher's own, or ours (Lora, the reader's text size). */
export function styleFor(mode, { fontSize = 18 } = {}) {
  if (mode !== 'readfocus') return BOOK_CSS;
  const font = new URL(loraUrl, globalThis.location?.href).href; // absolute: sections live at blob: URLs
  return `${BOOK_CSS}
@font-face { font-family: 'ReadFocus Lora'; src: url("${font}") format('woff2'); font-weight: 400 700; font-style: normal; }
html, body, p, li, blockquote, dd, dt, td, th, figcaption { font-family: 'ReadFocus Lora', Georgia, serif !important; }
body { font-size: ${fontSize}px !important; line-height: 1.62 !important; }
pre, code, kbd, samp { font-family: ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace !important; }`;
}

/** Clean what foliate hands over before it becomes a blob: sections, SVG documents and stylesheets. */
function guard(book, track) {
  book.transformTarget?.addEventListener('data', ({ detail }) => {
    const { type, name } = detail;
    if (/javascript|ecmascript/i.test(type ?? '')) { detail.data = ''; return; } // a book's scripts never run
    if (!DOCUMENT_TYPES.has(type) && type !== 'text/css') return;
    detail.data = Promise.resolve(detail.data).then(async (value) => {
      const text = typeof value === 'string' ? value : await value?.text?.();
      if (typeof text !== 'string') return value;
      if (type === 'text/css') return cleanCss(text);
      return sanitizeSection(text, { name, type, loadBlob: (path) => book.loadBlob(path), track });
    });
  });
}

/**
 * Open an EPUB ({ data } or { url }) into `container`. Resolves an engine:
 * { book, isFixedLayout, next, prev, goTo, setWide, setStyle, contents, close }.
 * onRelocate(location) fires on every page change with foliate's location
 * ({ cfi, fraction, tocItem, ... }); onLoad({ doc, index }) when a section renders.
 */
export async function openEpub(source, container, { onRelocate, onLoad, style = 'publisher', fontSize } = {}) {
  const { makeBook } = await import('../../vendor/foliate-js/view.js'); // also defines <foliate-view>
  const bytes = source.data ?? new Uint8Array(await (await fetch(source.url)).arrayBuffer());
  const book = await makeBook(new File([bytes], 'book.epub', { type: 'application/epub+zip' }));
  const urls = [];
  guard(book, (url) => urls.push(url));

  const view = document.createElement('foliate-view');
  view.style.cssText = 'display:block;width:100%;height:100%';
  container.append(view);
  if (onRelocate) view.addEventListener('relocate', (e) => onRelocate(e.detail));
  if (onLoad) view.addEventListener('load', (e) => onLoad(e.detail));
  await view.open(book);

  const { renderer } = view;
  const paginated = !view.isFixedLayout;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (paginated) {
    renderer.setAttribute('flow', 'paginated');
    renderer.setAttribute('margin', '40px');
    renderer.setAttribute('gap', '7%');
    renderer.setAttribute('max-inline-size', '640px');
    if (!reduced) renderer.setAttribute('animated', '');
  }
  const setWide = (wide) => paginated && renderer.setAttribute('max-column-count', wide ? '2' : '1');
  const setStyle = (mode, options) => renderer.setStyles?.(styleFor(mode, options));
  setWide(container.clientWidth >= SPREAD_MIN_WIDTH);
  setStyle(style, { fontSize });
  const resize = new ResizeObserver(() => setWide(container.clientWidth >= SPREAD_MIN_WIDTH));
  resize.observe(container);
  await view.init({});

  return {
    book,
    isFixedLayout: view.isFixedLayout,
    next: () => view.next(),
    prev: () => view.prev(),
    goTo: (target) => view.goTo(target),
    setWide,
    setStyle,
    contents: () => renderer.getContents?.() ?? [],
    close() {
      resize.disconnect();
      view.close();
      view.remove();
      urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    },
  };
}
