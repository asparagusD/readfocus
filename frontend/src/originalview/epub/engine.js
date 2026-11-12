// The one door to foliate-js (C17.3; decision D-C17.3). Everything foliate does
// for us is reached through openEpub, so a change in its unstable API is a
// change in this file only. The vendored code loads lazily, with this module.
import loraUrl from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url';
import { buildLocations } from '../frame';
import { BOOK_CSS, sanitizeSection } from './sanitize';
import { cleanCss } from './urls';

export const SPREAD_MIN_WIDTH = 1024; // two pages side by side from here up (as the C12 reader)
const DOCUMENT_TYPES = new Set(['application/xhtml+xml', 'text/html', 'image/svg+xml']);
export const MARGINS = { narrow: '4%', normal: '7%', wide: '11%' }; // the paginator's gap: page edges and gutter

/**
 * The extra CSS for a style mode: the publisher's own, or ours (Lora). Text size and
 * line height apply in both (C17.4): the root font size scales a book set in em or rem,
 * and ReadFocus style also sets the body. `themeCss` recolours for lamplight.
 */
export function styleFor(mode, { fontSize = 18, lineHeight = null, themeCss = '' } = {}) {
  const sizing = `html { font-size: ${Math.round((fontSize / 18) * 100)}% !important; }
${lineHeight ? `p, li, blockquote, dd, dt, figcaption { line-height: ${lineHeight} !important; }` : ''}`;
  if (mode !== 'readfocus') return `${BOOK_CSS}${sizing}${themeCss}`;
  const font = new URL(loraUrl, globalThis.location?.href).href; // absolute: sections live at blob: URLs
  return `${BOOK_CSS}${sizing}
@font-face { font-family: 'ReadFocus Lora'; src: url("${font}") format('woff2'); font-weight: 400 700; font-style: normal; }
html, body, p, li, blockquote, dd, dt, td, th, figcaption { font-family: 'ReadFocus Lora', Georgia, serif !important; }
body { font-size: ${fontSize}px !important; line-height: ${lineHeight ?? 1.62} !important; }
pre, code, kbd, samp { font-family: ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace !important; }
${themeCss}`;
}

/** Characters of text in `root` before (node, offset), counted as textContent counts them. */
export function charOffset(root, node, offset) {
  if (!root || !node) return 0;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text === node) return count + offset;
    if (node.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) return count; // passed it
    count += text.length;
  }
  return count;
}

/** Text length of every spine section, read once (C17.4 locations); the body's textContent. */
async function measureSections(book) {
  const chars = [];
  for (const section of book.sections) {
    try {
      const doc = await section.createDocument();
      chars.push(doc.body?.textContent.length ?? 0);
    } catch {
      chars.push(0);
    }
  }
  return chars;
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
 * { book, isFixedLayout, next, prev, goTo, setWide, setStyle, setMargins, locations, contents, close }.
 * onRelocate(location) fires on every page change with foliate's location ({ cfi, tocItem,
 * section, ... }) plus `index` and the visible text's `charStart` and `charEnd` in that
 * section; onLoad({ doc, index }) when a section renders. `animated: false` leaves page
 * turns to the book frame; `wide` (true, false) fixes the spread instead of the box's width.
 */
export async function openEpub(source, container, { onRelocate, onLoad, style = 'publisher', fontSize, animated = true, wide } = {}) {
  const { makeBook } = await import('../../vendor/foliate-js/view.js'); // also defines <foliate-view>
  const bytes = source.data ?? new Uint8Array(await (await fetch(source.url)).arrayBuffer());
  const book = await makeBook(new File([bytes], 'book.epub', { type: 'application/epub+zip' }));
  const urls = [];
  guard(book, (url) => urls.push(url));

  const view = document.createElement('foliate-view');
  view.style.cssText = 'display:block;width:100%;height:100%';
  container.append(view);
  if (onRelocate) {
    view.addEventListener('relocate', ({ detail }) => {
      const { range } = detail;
      const body = range?.startContainer?.ownerDocument?.body;
      onRelocate({
        ...detail,
        index: detail.section?.current ?? 0,
        charStart: range ? charOffset(body, range.startContainer, range.startOffset) : 0,
        charEnd: range ? charOffset(body, range.endContainer, range.endOffset) : 0,
      });
    });
  }
  if (onLoad) view.addEventListener('load', (e) => onLoad(e.detail));
  await view.open(book);

  const { renderer } = view;
  const paginated = !view.isFixedLayout;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (paginated) {
    renderer.setAttribute('flow', 'paginated');
    renderer.setAttribute('margin', '40px');
    renderer.setAttribute('gap', MARGINS.normal);
    renderer.setAttribute('max-inline-size', '640px');
    if (animated && !reduced) renderer.setAttribute('animated', '');
  }
  const setWide = (wide) => paginated && renderer.setAttribute('max-column-count', wide ? '2' : '1');
  const setStyle = (mode, options) => renderer.setStyles?.(styleFor(mode, options));
  const setMargins = (name) => paginated && renderer.setAttribute('gap', MARGINS[name] ?? MARGINS.normal);
  setStyle(style, { fontSize });
  // `wide` from the book frame decides the spread (C17.4); without it, the box's own width does.
  const auto = wide === undefined;
  setWide(auto ? container.clientWidth >= SPREAD_MIN_WIDTH : wide);
  const resize = new ResizeObserver(() => auto && setWide(container.clientWidth >= SPREAD_MIN_WIDTH));
  resize.observe(container);
  await view.init({});

  /** Stable page numbers, measured once per book and kept under `cacheKey` in this browser. */
  async function locations(cacheKey) {
    const key = cacheKey && `rf-epub-locations:${cacheKey}`;
    try {
      const saved = key && JSON.parse(localStorage.getItem(key) ?? 'null');
      if (saved?.chars?.length === book.sections.length) return buildLocations(saved.chars);
    } catch { /* private window or bad data: measure again */ }
    const chars = await measureSections(book);
    try { if (key) localStorage.setItem(key, JSON.stringify({ chars })); } catch { /* not kept; fine */ }
    return buildLocations(chars);
  }

  return {
    book,
    isFixedLayout: view.isFixedLayout,
    next: () => view.next(),
    prev: () => view.prev(),
    goTo: (target) => view.goTo(target),
    goToFraction: (fraction) => view.goToFraction(fraction),
    lastLocation: () => view.lastLocation,
    setWide,
    setStyle,
    setMargins,
    locations,
    contents: () => renderer.getContents?.() ?? [],
    close() {
      resize.disconnect();
      view.close();
      view.remove();
      urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    },
  };
}
