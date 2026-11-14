// The book frame's rules (C17.4), shared by the PDF and EPUB renderers and kept
// free of the DOM so they run under node --test: spreads, zoom, folios, EPUB
// location numbers, keys, the contents entry for a page, and lamplight CSS.

export const SPREAD_MIN_WIDTH = 1024; // two pages side by side from here up (C12, handoff)

/** The PDF pages shown with `page`: a spread opens with page 1 alone on the right, then 2-3, 4-5... */
export function spreadPages(page, numPages, wide) {
  if (!wide || page === 1) return [page];
  const left = page % 2 === 0 ? page : page - 1;
  return left + 1 <= numPages ? [left, left + 1] : [left];
}

/** The first page shown after turning by `dir` (+1 or -1) from the view holding `page`. */
export function stepSpread(page, numPages, wide, dir) {
  if (!wide) return Math.min(numPages, Math.max(1, page + dir));
  const [first] = spreadPages(page, numPages, true);
  if (dir > 0) return first === 1 ? Math.min(2, numPages) : first + 2 <= numPages ? first + 2 : first;
  return first <= 2 ? 1 : first - 2;
}

export const ZOOMS = ['fit-page', 'fit-width', 1.25, 1.5, 1.75, 2];
const CSS_PX_PER_POINT = 96 / 72; // 100 % is the page at its printed size

/** CSS pixels per PDF point for a zoom, a page size in points, the frame, and pages across. */
export function pdfScale(zoom, page, frame, columns = 1) {
  const across = Math.max(1, frame.width) / columns / page.width;
  const down = Math.max(1, frame.height) / page.height;
  const scale = zoom === 'fit-page' ? Math.min(across, down) : zoom === 'fit-width' ? across : zoom * CSS_PX_PER_POINT;
  return Math.max(0.1, scale);
}

/** The next zoom in or out of ZOOMS, stopping at the ends. */
export function zoomStep(zoom, dir) {
  const at = Math.max(0, ZOOMS.indexOf(zoom));
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + dir))];
}

export const zoomLabel = (zoom) => (zoom === 'fit-page' ? 'Fit page' : zoom === 'fit-width' ? 'Fit width' : `${Math.round(zoom * 100)}%`);

/** "p. 5 of 300" or "pp. 44–45 of 380", using the PDF's own page labels when it has them. */
export function pdfFolio(pages, numPages, labels) {
  const name = (p) => labels?.[p - 1] || String(p);
  const shown = pages.length > 1 ? `pp. ${name(pages[0])}–${name(pages.at(-1))}` : `p. ${name(pages[0])}`;
  return `${shown} of ${numPages}`;
}

/**
 * Stable page numbers for an EPUB (C17.4): one "page" per `perPage` characters of
 * text, counted once per book, so a number does not change with the font size or
 * the window. `chars[i]` is the text length of spine section i.
 */
export function buildLocations(chars, perPage = 1500) {
  const starts = [];
  let sum = 0;
  for (const n of chars) {
    starts.push(sum);
    sum += n;
  }
  return { starts, chars: [...chars], total: Math.max(1, Math.ceil(sum / perPage)), perPage };
}

/** The 1-based page holding character `charsBefore` of section `index`, or null before locations exist. */
export function locationAt(locations, index, charsBefore) {
  if (!locations || locations.starts[index] === undefined) return null;
  const page = Math.floor((locations.starts[index] + Math.max(0, charsBefore)) / locations.perPage) + 1;
  return Math.min(locations.total, page);
}

/** What a key does in the book; null leaves it to the browser (modifier shortcuts, typing). */
export function keyAction({ key, shiftKey = false, ctrlKey = false, metaKey = false, altKey = false }) {
  if (ctrlKey || metaKey || altKey) return null;
  if (shiftKey && key.startsWith('Arrow')) return null; // C21.2: Shift+arrows grow a selection
  if (key === 'ArrowRight' || key === 'PageDown' || (key === ' ' && !shiftKey)) return 'next';
  if (key === 'ArrowLeft' || key === 'PageUp' || (key === ' ' && shiftKey)) return 'prev';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (key === 'b' || key === 'B') return 'ribbon';
  return null;
}

/** The contents entry a page belongs to: the last one starting on or before it. */
export function entryForPage(entries, page) {
  let found = null;
  for (const entry of entries ?? []) if (entry.page <= page && (!found || entry.page >= found.page)) found = entry;
  return found;
}

/**
 * Lamplight for an EPUB section: text and backgrounds take the theme's colours;
 * images, SVG drawings (and everything inside them), video and canvas keep the
 * publisher's colours. No filter is ever applied, so nothing is inverted.
 */
export function epubThemeCss({ background, foreground, link, code }) {
  const text = ':not(img):not(svg):not(svg *):not(video):not(canvas):not(picture)';
  return `
html, body { background-color: ${background} !important; color: ${foreground} !important; }
body *${text} { color: inherit !important; background-color: transparent !important; border-color: color-mix(in srgb, ${foreground} 25%, transparent) !important; }
body a${text}, body a${text} * { color: ${link} !important; }
body pre, body pre *${text} { background-color: ${code} !important; }
`;
}

/** The fraction of an animation's time at which a cubic-bezier easing reaches `progress`. */
export function timeAtProgress([x1, y1, x2, y2], progress) {
  const at = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid, y1, y2) < progress) lo = mid;
    else hi = mid;
  }
  return at(lo, x1, x2);
}
