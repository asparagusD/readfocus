// Edge's Add text on a PDF page (C39.6, issue 23; docs/ANCHORS.md A12), pure, so it runs under node --test. A text
// box is kept in PDF points from the page's top-left: its top-left (x, y), its width, its text and font size, so zoom
// and Page view only rescale it. It is placed where the reader clicks, kept inside the page.

export const TEXT_SIZES = [8, 10, 12, 14, 18, 24, 32]; // points, Add text's size choices
export const BOX_WIDTHS = [96, 144, 192, 240, 320, 400]; // points, Add text's width choices
export const DEFAULT_TEXT = { colour: 'ink', size: 12, width: 192 };
export const TEXT_MAX = 2_000; // as the server's policy.MARK_TEXT_MAX
export const ADD_TEXT_EVENT = 'rf-add-text'; // { page }: Enter with Add text on asks that page for a box
const MAX_COORD = 9_999; // A4's line limit

const round = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Where a box goes for a press at page point (x, y): there, but kept inside the page `page` ({ width, height }). */
export function placeAt([x, y], style, page) {
  return {
    x: round(clamp(x, 0, Math.min(MAX_COORD, Math.max(0, page.width - style.width)))),
    y: round(clamp(y, 0, Math.min(MAX_COORD, Math.max(0, page.height - style.size * 1.25)))),
  };
}

/** A box's data moved by (dx, dy) points, kept inside the page. */
export function moveBy(data, dx, dy, page) {
  return { ...data, ...placeAt([data.x + dx, data.y + dy], { width: data.width, size: data.size }, page) };
}

/** A box's place and size on screen, in CSS px at `scale` (CSS px per point). */
export const boxStyle = (data, scale) => ({
  left: data.x * scale, top: data.y * scale, width: data.width * scale, fontSize: data.size * scale,
});

/** The POST /books/{id}/marks body for a new box with `text` at `at` ({ x, y }) on `page`. */
export const newTextBox = (page, at, text, style) => ({
  kind: 'text', page, color: style.colour,
  data: { x: at.x, y: at.y, width: style.width, text: text.slice(0, TEXT_MAX), size: style.size },
});

/** Add text's colour, size and width, kept on this device; the defaults when nothing (or nonsense) is stored. */
const KEY = 'rf-text';
export function readTextStyle(colours, store = globalThis.localStorage) {
  try {
    const stored = JSON.parse(store?.getItem(KEY) ?? 'null');
    return {
      colour: colours.includes(stored?.colour) ? stored.colour : DEFAULT_TEXT.colour,
      size: TEXT_SIZES.includes(stored?.size) ? stored.size : DEFAULT_TEXT.size,
      width: BOX_WIDTHS.includes(stored?.width) ? stored.width : DEFAULT_TEXT.width,
    };
  } catch {
    return { ...DEFAULT_TEXT };
  }
}
export function storeTextStyle(style, store = globalThis.localStorage) {
  try { store?.setItem(KEY, JSON.stringify(style)); } catch { /* private mode: the defaults come back next time */ }
}
