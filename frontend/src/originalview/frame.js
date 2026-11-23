// The book frame's rules (C17.4), shared by the PDF and EPUB renderers and kept
// free of the DOM so they run under node --test: zoom, folios, EPUB location
// numbers, keys and the contents entry for a page (C38.3: no lamplight CSS). C38.2: a PDF
// scrolls (scroll.js), so its spreads are gone; an EPUB keeps SPREAD_MIN_WIDTH.

export const SPREAD_MIN_WIDTH = 1024; // two pages side by side from here up (C12, handoff)

// C41.1 (issue 28): a zoom is 'fit-page', 'fit-width' or a fraction of the printed size; − and + step through Edge's
// levels from wherever the view is, a fitted one included, and a typed percentage is kept to 25-500 %.
export const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export const MIN_ZOOM = ZOOMS[0];
export const MAX_ZOOM = ZOOMS.at(-1);
const CSS_PX_PER_POINT = 96 / 72; // 100 % is the page at its printed size
const clampZoom = (zoom) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** CSS pixels per PDF point for a zoom, a page size in points, the frame, and pages across; anything else fits the page. */
export function pdfScale(zoom, page, frame, columns = 1) {
  const across = Math.max(1, frame.width) / columns / page.width;
  const down = Math.max(1, frame.height) / page.height;
  if (typeof zoom === 'number' && Number.isFinite(zoom)) return clampZoom(zoom) * CSS_PX_PER_POINT;
  return Math.max(0.1, zoom === 'fit-width' ? across : Math.min(across, down));
}

/** The whole percentage a scale (CSS pixels per point) shows the page at. */
export const zoomPercent = (scale) => Math.round((scale / CSS_PX_PER_POINT) * 100);

/**
 * The next of Edge's levels in or out from the zoom, or from `percent` (the one shown) when the zoom is a fit; the
 * zoom unchanged at the ends, or for a fit whose percentage is not known yet.
 */
export function zoomStep(zoom, dir, percent = null) {
  const numeric = typeof zoom === 'number' && Number.isFinite(zoom);
  const at = numeric ? clampZoom(zoom) : Number.isFinite(percent) ? percent / 100 : null;
  if (at === null) return zoom;
  const next = dir > 0 ? ZOOMS.find((z) => z > at + 0.005) : ZOOMS.findLast((z) => z < at - 0.005);
  return next ?? zoom;
}

/** A typed zoom ("150", "150%", " 87.5 % ") as a fraction kept to 25-500 %; null for anything else. */
export function parseZoom(text) {
  const match = /^\s*(\d{1,4}(?:\.\d+)?)\s*%?\s*$/.exec(String(text ?? ''));
  return match && Number(match[1]) > 0 ? Math.round(clampZoom(Number(match[1]) / 100) * 100) / 100 : null;
}

/**
 * C41.1: the pixel ratio a page `width` x `height` CSS px is drawn at: the screen's, lowered so the canvas holds at
 * most `max` pixels (PDF.js's own viewer caps it at 2^24 too), so a page at 500 % stays in memory and the browser's
 * canvas limit; the page keeps its size on screen, a little softer.
 */
export const MAX_CANVAS_PIXELS = 2 ** 24;
export function canvasRatio(width, height, ratio, max = MAX_CANVAS_PIXELS) {
  const area = Math.max(1, width) * Math.max(1, height);
  return Math.min(ratio, Math.sqrt(max / area));
}

/** C38.9: an EPUB's text sizes, and the next one in or out (Ctrl+= and Ctrl+-, the toolbar's A and A), stopping at the ends. */
export const FONT_SIZES = [14, 16, 18, 20, 22, 24];
export function fontStep(size, dir) {
  const at = FONT_SIZES.indexOf(size);
  return FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, (at < 0 ? FONT_SIZES.indexOf(18) : at) + dir))];
}

/**
 * C38.9 (issue 22): Edge's reader shortcuts, from a keydown: 'find' (Ctrl+F), 'find-next' and 'find-prev' (Ctrl+G,
 * Ctrl+Shift+G), 'go-to-page' (Ctrl+Alt+G), 'fit' (Ctrl+\), 'zoom-in' and 'zoom-out' (Ctrl+= or Ctrl++, Ctrl+-); Cmd
 * for Ctrl on a Mac. Null for anything else, Ctrl+0 and the wheel too: the browser's own zoom is left alone.
 * C40.2c (issue 24): 'read-aloud' (Ctrl+Shift+U), as Edge's. C40.4c: 'save' (Ctrl+S) and 'save-as' (Ctrl+Shift+S).
 * C40.5: 'print' (Ctrl+P): the book, not the app's page.
 */
export function readerShortcut({ key = '', code = '', ctrlKey = false, metaKey = false, shiftKey = false, altKey = false }) {
  if (!ctrlKey && !metaKey) return null;
  if (code === 'KeyG' || key.toLowerCase() === 'g') {
    if (altKey) return shiftKey ? null : 'go-to-page';
    return shiftKey ? 'find-prev' : 'find-next';
  }
  if (altKey) return null;
  if ((code === 'KeyU' || key.toLowerCase() === 'u') && shiftKey) return 'read-aloud';
  if (code === 'KeyS' || key.toLowerCase() === 's') return shiftKey ? 'save-as' : 'save';
  if ((code === 'KeyP' || key.toLowerCase() === 'p') && !shiftKey) return 'print';
  if ((code === 'KeyF' || key.toLowerCase() === 'f') && !shiftKey) return 'find';
  if ((code === 'Backslash' || key === '\\') && !shiftKey) return 'fit';
  if (code === 'Equal' || code === 'NumpadAdd' || key === '=' || key === '+') return 'zoom-in';
  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-' || key === '_') return 'zoom-out';
  return null;
}

/** The zoom as Edge shows it, a percentage (a fit's from `percent`); "Fit page" or "Fit width" until that is known. */
export function zoomLabel(zoom, percent = null) {
  if (typeof zoom === 'number' && Number.isFinite(zoom)) return `${Math.round(clampZoom(zoom) * 100)}%`;
  if (Number.isFinite(percent)) return `${percent}%`;
  return zoom === 'fit-width' ? 'Fit width' : 'Fit page';
}

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

/**
 * C38.7b: where location page `page` (1-based, as locationAt counts) begins: { index, char } in the section holding
 * its first character (empty sections skipped), the page clamped to the book; null before locations exist.
 */
export function locationPlace(locations, page) {
  if (!locations?.chars?.length) return null;
  const offset = (Math.min(Math.max(1, Math.round(page)), locations.total) - 1) * locations.perPage;
  let last = null;
  for (let index = 0; index < locations.chars.length; index += 1) {
    const size = locations.chars[index];
    if (!size) continue;
    const start = locations.starts[index];
    if (offset < start + size) return { index, char: Math.max(0, offset - start) };
    last = { index, char: size - 1 };
  }
  return last;
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
