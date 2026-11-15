/**
 * Where focus mode's bookmark goes (C23.6b, docs/ANCHORS.md A3): a point anchor at the end of the page the
 * reader sets the ribbon on, so the quiz covers that whole page and the server can check it comes after the
 * session's start.
 */
const A4_LINE_MAX = 9_999; // an A4 position keeps a PDF line under 10,000 points

/** A point at the bottom of PDF page `page` of height `height` (points). */
export function pdfPageEnd(page, height) {
  const y = Math.min(A4_LINE_MAX, Math.max(0, Math.round(height)));
  return { kind: 'pdf', page, quads: [[0, y, 0, y]], text: '' };
}

/** The end of an EPUB range CFI (the page shown) as a point CFI, or null. */
export function epubEndPoint(rangeCfi) {
  const match = /^epubcfi\((.*)\)$/.exec(rangeCfi ?? '');
  const parts = match ? match[1].split(',') : [];
  if (parts.length !== 3) return null;
  return { kind: 'epub', cfi: `epubcfi(${parts[0]}${parts[2]})`, text: '' };
}

/** Which of `count` pages side by side in `box` the x coordinate falls on. */
export function pageForX(x, box, count) {
  if (count <= 1) return 0;
  const at = Math.floor(((x - box.left) / box.width) * count);
  return Math.min(count - 1, Math.max(0, at));
}
