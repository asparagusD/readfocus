/**
 * Page geometry of the paginated reader (C12.3). Pure: no DOM.
 *
 * The book text is one CSS multi-column flow whose column is one page's
 * text block. Margins are equal on both sides of a page, so the distance
 * from one column to the next (column + gap) is exactly one page width:
 * page n's text starts at n * stride, on a spread and on a single page.
 */
export const SPREAD_MIN_WIDTH = 1024; // A9's lg breakpoint
export const LINE_HEIGHT = 1.72; // --text-reading--line-height
const PAGE_MAX_WIDTH = 640; // keeps the measure near 60-70 characters
const PAGE_MAX_RATIO = 1.55; // height to width, about a trade paperback
const STATUS_BAND = 48; // page-turn controls and "p. 3 of 14" under the book

export function lineHeight(fontSize) {
  return fontSize * LINE_HEIGHT;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Sizes for a frame of `width` x `height` px at `fontSize` px. */
export function pageGeometry({ width, height, fontSize = 18 }) {
  const spread = width >= SPREAD_MIN_WIDTH;
  const perView = spread ? 2 : 1;
  // Room around the book inside the frame; a phone page is the screen itself (handoff, 375 px reading screen).
  const flush = !spread && width < 480;
  const outer = spread ? 48 : flush ? 0 : 12;
  const pageWidth = Math.floor(Math.min(PAGE_MAX_WIDTH, (width - 2 * outer) / perView));
  // Phone pages keep slimmer margins: the measure is short already, and justified text needs every character.
  const margin = Math.round(clamp(pageWidth * (pageWidth < 480 ? 0.065 : 0.09), 20, 56));
  const head = spread ? 56 : 44; // running head band
  const foot = spread ? 52 : 40; // folio band
  const line = lineHeight(fontSize);
  const available = Math.min(height - STATUS_BAND, pageWidth * PAGE_MAX_RATIO) - head - foot;
  const textHeight = Math.max(4, Math.floor(available / line)) * line;
  return {
    spread, flush, perView, pageWidth, margin, head, foot, fontSize,
    pageHeight: head + textHeight + foot,
    column: pageWidth - 2 * margin,
    gap: 2 * margin,
    stride: pageWidth,
    textHeight,
    statusBand: STATUS_BAND,
  };
}

/** Pages in a flow whose content is `scrollWidth` px wide (columns plus the gaps between them). */
export function pageCount(scrollWidth, g) {
  return Math.max(1, Math.round((scrollWidth + g.gap) / g.stride));
}

/** The page holding a point `x` px from the start of the flow. */
export function pageOfX(x, g) {
  return Math.max(0, Math.floor((x + 0.5) / g.stride));
}

/** The first page of the view (spread or single page) that shows `page`. */
export function firstPageOfView(page, perView) {
  return page - (page % perView);
}

/** A page that starts a view and exists. */
export function clampPage(page, count, perView) {
  return firstPageOfView(clamp(page, 0, Math.max(0, count - 1)), perView);
}
