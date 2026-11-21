// The one door to foliate-js (C17.3; decision D-C17.3). Everything foliate does
// for us is reached through openEpub, so a change in its unstable API is a
// change in this file only. The vendored code loads lazily, with this module.
import loraUrl from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url';
import { buildLocations } from '../frame';
import * as CFI from '../../vendor/foliate-js/epubcfi.js';
import { BOOK_CSS, sanitizeSection } from './sanitize';
import { cleanCss } from './urls';

export const SPREAD_MIN_WIDTH = 1024; // two pages side by side from here up (as the C12 reader)
const DOCUMENT_TYPES = new Set(['application/xhtml+xml', 'text/html', 'image/svg+xml']);
export const MARGINS = { narrow: '4%', normal: '7%', wide: '11%' }; // the paginator's gap: the column's side margins
const OVERSCROLL_PX = 240; // C38.7a: wheel past a section's end (or start) this far and the next (or previous) opens
const SWIPE_PX = 80; // the same for a swipe up (or down) at a section's end (or start)
// C38.7a: room above a section's first line and below its last; under the book's last section enough for the end
// of the book's card to sit under no text.
const FLOW_CSS = 'body { padding-block: 48px 64px !important; }';
const LAST_CSS = 'body { padding-bottom: 176px !important; }';

/**
 * The extra CSS for a style mode: the publisher's own, or ours (Lora). Text size and
 * line height apply in both (C17.4): the root font size scales a book set in em or rem,
 * and ReadFocus style also sets the body. `themeCss` is added last (nothing passes it since C38.3: no recolouring).
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

/** A collapsed range at character `char` of root's text (textContent order), or null past its end. */
export function rangeAtChar(root, char) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (count + text.length > char) {
      const range = root.ownerDocument.createRange();
      range.setStart(text, char - count);
      range.collapse(true);
      return range;
    }
    count += text.length;
  }
  return null;
}

/**
 * C38.5c: ranges over characters [start, end] of root's text (textContent order), one for each of `spans` (in order,
 * not overlapping, as find's matches are), or null for one past the text's end; one walk over the text.
 */
export function rangesOf(root, spans) {
  const out = spans.map(() => null);
  if (!root || !spans.length) return out;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  let i = 0;
  let open = null;
  for (let text = walker.nextNode(); text && i < spans.length; text = walker.nextNode()) {
    const end = count + text.length;
    while (i < spans.length) {
      const [from, to] = spans[i];
      if (!open) {
        if (from >= end) break;
        open = root.ownerDocument.createRange();
        open.setStart(text, Math.max(0, from - count));
      }
      if (to > end) break;
      open.setEnd(text, to - count);
      out[i] = open;
      open = null;
      i += 1;
    }
    count = end;
  }
  return out;
}

/** A collapsed range in text widened over the character after it, so it has a box on its own page. */
function around(range) {
  const node = range?.startContainer;
  if (!range?.collapsed || node?.nodeType !== Node.TEXT_NODE || range.startOffset >= node.length) return range;
  const wide = range.cloneRange();
  wide.setEnd(node, range.startOffset + 1);
  return wide;
}

/** A section's text squeezed (place.js), with each kept character's offset in the body's text. */
function squeezedText(body) {
  const text = body?.textContent ?? '';
  const at = [];
  let flat = '';
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    flat += text[i].toLowerCase();
    at.push(i);
  }
  return { flat, at };
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
 * C38.7a (issue 22, D1): a scrolled section opens the next one when the reader keeps scrolling past its end (and the
 * previous one past its start), by wheel or by swipe, so the book reads on as one scroll. `at()` says whether the
 * view is at the section's top and bottom.
 */
function overscroll(renderer, at) {
  let push = 0;
  let calm = null;
  let touch = null;
  const go = (dir) => {
    push = 0;
    return dir > 0 ? renderer.next() : renderer.prev();
  };
  const onWheel = (event) => {
    const { top, bottom } = at();
    if (!((event.deltaY > 0 && bottom) || (event.deltaY < 0 && top))) {
      push = 0;
      return;
    }
    push += event.deltaY;
    clearTimeout(calm);
    calm = setTimeout(() => { push = 0; }, 400);
    if (Math.abs(push) >= OVERSCROLL_PX) go(Math.sign(push));
  };
  const onTouchStart = (event) => { touch = event.touches[0]?.clientY ?? null; };
  const onTouchEnd = (event) => {
    const end = event.changedTouches[0]?.clientY;
    if (touch === null || end === undefined) return;
    const dy = touch - end; // up is forward
    touch = null;
    const { top, bottom } = at();
    if ((dy > SWIPE_PX && bottom) || (dy < -SWIPE_PX && top)) go(Math.sign(dy));
  };
  return (target) => {
    target.addEventListener('wheel', onWheel, { passive: true });
    target.addEventListener('touchstart', onTouchStart, { passive: true });
    target.addEventListener('touchend', onTouchEnd, { passive: true });
  };
}

/**
 * Open an EPUB ({ data } or { url }) into `container`. Resolves an engine:
 * { book, isFixedLayout, next, prev, goTo, setWide, setStyle, setMargins, locations, contents, close }.
 * onRelocate(location) fires on every page change with foliate's location ({ cfi, tocItem,
 * section, ... }) plus `index` and the visible text's `charStart` and `charEnd` in that
 * section; onLoad({ doc, index }) when a section renders. `animated: false` leaves page
 * turns to the book frame; `wide` (true, false) fixes the spread instead of the box's width.
 * C38.7a (issue 22): a reflowable book is scrolled (foliate's scrolled flow, a column at most 640 px wide), section by
 * section, one opening the next as the reader scrolls on (overscroll); the location says `atStart` and `atEnd` (the
 * book's first section's top, its last section's bottom), and `scrollBy(px)` moves it a little. A fixed-layout book
 * still turns page by page.
 */
export async function openEpub(source, container, { onRelocate, onLoad, style = 'publisher', fontSize, animated = true, wide } = {}) {
  const { makeBook } = await import('../../vendor/foliate-js/view.js'); // also defines <foliate-view>
  const bytes = source.data ?? new Uint8Array(await (await fetch(source.url)).arrayBuffer());
  const book = await makeBook(new File([bytes], 'book.epub', { type: 'application/epub+zip' }));
  const urls = [];
  guard(book, (url) => urls.push(url));

  const view = document.createElement('foliate-view');
  const linear = book.sections.map((section, i) => (section.linear !== 'no' ? i : -1)).filter((i) => i >= 0);
  view.style.cssText = 'display:block;width:100%;height:100%';
  container.append(view);
  let scrolled = false;
  let shown = { index: 0, textEnd: false }; // C38.7a: the section in view, and whether its last words are
  /** The scrolled view at its section's top and bottom (C38.7a). */
  const edges = () => {
    const r = view.renderer;
    return { top: (r?.start ?? 0) <= 2, bottom: (r?.viewSize ?? 0) - (r?.end ?? 0) <= 2 };
  };
  if (onRelocate) {
    view.addEventListener('relocate', ({ detail }) => {
      const { range } = detail;
      const body = range?.startContainer?.ownerDocument?.body;
      const index = detail.section?.current ?? 0;
      const { top, bottom } = scrolled ? edges() : {};
      shown = { index, textEnd: Boolean(range) && charOffset(body, range.endContainer, range.endOffset) >= (body?.textContent.length ?? 0) };
      onRelocate({
        ...detail,
        ...(scrolled ? { atStart: index <= linear[0] && top, atEnd: index >= linear.at(-1) && bottom } : {}),
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
  if (paginated) { // C38.7a: scrolled, not paged
    scrolled = true;
    renderer.setAttribute('flow', 'scrolled');
    renderer.setAttribute('margin', '0px'); // no running head: the view's top is the text's (anchors and ranges exact)
    renderer.setAttribute('gap', MARGINS.normal);
    renderer.setAttribute('max-inline-size', '640px');
    const watch = overscroll(renderer, edges);
    watch(renderer);
    // At the book's very end (its closing card in view), a relayout (a resize, a new text size) keeps it there, as a
    // PDF's does (C38.4a); foliate would hold the line at the top instead, leaving the end below the view.
    let atBookEnd = false;
    renderer.addEventListener('relocate', ({ detail }) => {
      const end = detail.index >= linear.at(-1) && edges().bottom;
      if (atBookEnd && !end && detail.reason === 'anchor' && detail.index === linear.at(-1)) renderer.goTo({ index: detail.index, anchor: 1 });
      else atBookEnd = end;
    });
    view.addEventListener('load', ({ detail }) => {
      watch(detail.doc);
      if (detail.index === linear.at(-1)) { // room under the book's last words for its closing card
        const style = detail.doc.createElement('style');
        style.textContent = LAST_CSS;
        detail.doc.head?.append(style);
      }
    });
  } else if (animated && !reduced) renderer.setAttribute('animated', '');
  const setWide = (wide) => !scrolled && paginated && renderer.setAttribute('max-column-count', wide ? '2' : '1');
  const setStyle = (mode, options) => renderer.setStyles?.(`${styleFor(mode, options)}${scrolled ? FLOW_CSS : ''}`);
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

  // Today's chunks are found by their text (C17.5) in the sections as packaged; the reader then
  // goes to the same character in the shown (sanitized) section.
  const texts = new Map();
  const sectionText = (index) => {
    if (!texts.has(index)) {
      texts.set(index, Promise.resolve(book.sections[index].createDocument())
        .then((doc) => squeezedText(doc.body)).catch(() => ({ flat: '', at: [] })));
    }
    return texts.get(index);
  };
  // C38.5c: a section's whole text as packaged (its body's textContent), read once, for find.
  const plain = new Map();
  const sectionPlain = (index) => {
    if (!plain.has(index)) {
      plain.set(index, Promise.resolve(book.sections[index]?.createDocument?.())
        .then((doc) => doc?.body?.textContent ?? '').catch(() => ''));
    }
    return plain.get(index);
  };
  /** { kind: 'epub', index, char } for the first section holding a snippet (longest first), or null. */
  async function find(snippets) {
    for (const snippet of snippets) {
      for (let index = 0; index < book.sections.length; index++) {
        const { flat, at } = await sectionText(index);
        const hit = snippet ? flat.indexOf(snippet) : -1;
        if (hit >= 0) return { kind: 'epub', index, char: at[hit] };
      }
    }
    return null;
  }

  return {
    book,
    isFixedLayout: view.isFixedLayout,
    find,
    sectionPlain, // C38.5c
    rangesOf,
    sectionCount: () => book.sections.length,
    /** C38.5c: a find match ({ index, start, end }) on screen: the page holding it. */
    goToMatch: ({ index, start, end }) => renderer.goTo({ index, anchor: (doc) => rangesOf(doc.body, [[start, end]])[0] ?? doc.body }),
    goToChar: ({ index, char }) => renderer.goTo({ index, anchor: (doc) => around(rangeAtChar(doc.body, char)) ?? doc.body }),
    // A saved point CFI (C17.6): aimed at its first character, as a collapsed range at a page's
    // first character resolves to the page before it (DEBUG_LOG C17.6).
    goToPoint: (cfi) => {
      const { index, anchor } = view.resolveCFI(cfi);
      return renderer.goTo({ index, anchor: (doc) => around(anchor(doc)) });
    },
    sectionOf: (href) => { try { return book.resolveHref(href)?.index ?? null; } catch { return null; } },
    pointCfi: (cfi) => (cfi ? CFI.collapse(cfi) : cfi),
    /** A point CFI at character `char` of shown section `index`'s text, or null when it is not shown. */
    pointAt: (index, char) => {
      const shown = (renderer.getContents?.() ?? []).find((c) => c.index === index);
      const range = shown && rangeAtChar(shown.doc.body, char);
      return range ? view.getCFI(index, range) : null;
    },
    /** The range CFI of a range in a shown section's document (C17.6 anchors), or null. */
    cfiFor: (doc, range) => {
      const shown = (renderer.getContents?.() ?? []).find((c) => c.doc === doc);
      return shown ? view.getCFI(shown.index, range) : null;
    },
    /** The DOM range a CFI names in shown section document `doc`, or null when it is another section's (C21.3). */
    rangeFor: (doc, cfi) => {
      const shown = (renderer.getContents?.() ?? []).find((c) => c.doc === doc);
      try {
        const { index, anchor } = view.resolveCFI(cfi);
        return shown && index === shown.index ? anchor(doc) : null;
      } catch {
        return null;
      }
    },
    /** [start, end]: characters of the section's text before each end of `range` (C21.2, ANCHORS A4). */
    charsOf: (doc, range) => [charOffset(doc.body, range.startContainer, range.startOffset),
      charOffset(doc.body, range.endContainer, range.endOffset)],
    // C38.7a: once a section's last words are in view, Next opens the next section (not the blank space below them)
    next: () => (scrolled && shown.textEnd && shown.index < linear.at(-1)
      ? renderer.goTo({ index: linear.find((i) => i > shown.index), anchor: 0 }) : view.next()),
    prev: () => view.prev(),
    scrollBy: (px) => (px > 0 ? renderer.next(px) : renderer.prev(-px)), // C38.7a: a little, as Up and Down do
    scrolled,
    goTo: (target) => view.goTo(target),
    goToFraction: (fraction) => view.goToFraction(fraction),
    /** C38.7a: the book's last words (scrolled: the last section's foot, where its closing card shows). */
    goToEnd: () => (scrolled ? renderer.goTo({ index: linear.at(-1), anchor: 1 }) : view.goToFraction(1)),
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
