// Anchors (docs/ANCHORS.md, C17.6), shared by the PDF and EPUB renderers and free of the
// DOM, so they run under node --test. A PDF anchor is { kind: 'pdf', page, quads, text }
// with quads in PDF points from the page's top-left; an EPUB anchor is
// { kind: 'epub', cfi, text }. Highlights, notes, bookmarks and the reading position use them.

const POINT = [[0, 0, 0, 0]];
const LINE_SLACK_PT = 3; // rects whose tops differ by less than this are one line
const round = (n) => Math.round(n * 100) / 100;

/** Text as anchors store it: whitespace collapsed, ends trimmed (A1). */
export const textOf = (text) => (text ?? '').replace(/\s+/g, ' ').trim();

/**
 * One quad per line, [x0, y0, x1, y1] in points from the page's top-left (A1), from the
 * selection's screen rects. `page` is the page box's top-left on screen and `scale` its CSS
 * pixels per point, so the same selection gives the same quads at any zoom (A5).
 */
export function quadsFromRects(rects, page, scale) {
  const lines = [];
  const boxes = [...rects]
    .filter((r) => r.right > r.left && r.bottom > r.top)
    .map((r) => [(r.left - page.left) / scale, (r.top - page.top) / scale, (r.right - page.left) / scale, (r.bottom - page.top) / scale])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const box of boxes) {
    const line = lines.find((q) => Math.abs(q[1] - box[1]) < LINE_SLACK_PT);
    if (line) {
      line[0] = Math.min(line[0], box[0]);
      line[1] = Math.min(line[1], box[1]);
      line[2] = Math.max(line[2], box[2]);
      line[3] = Math.max(line[3], box[3]);
    } else lines.push([...box]);
  }
  return lines.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map((q) => q.map(round));
}

/** Screen boxes { left, top, width, height } for quads on a page drawn at `scale`, its top-left at `page`. */
export const rectsFromQuads = (quads, page, scale) => quads.map(([x0, y0, x1, y1]) => ({
  left: round(page.left + x0 * scale), top: round(page.top + y0 * scale), width: round((x1 - x0) * scale), height: round((y1 - y0) * scale),
}));

/** A PDF anchor on 1-based `page`; with no quads it is a point at the page's top-left (A3). */
export const pdfAnchor = (page, quads, text = '') => (quads.length
  ? { kind: 'pdf', page, quads, text: textOf(text) }
  : { kind: 'pdf', page, quads: POINT, text: '' });

export const epubAnchor = (cfi, text = '') => ({ kind: 'epub', cfi, text: textOf(text) });

/**
 * { spine, steps, offset } for a CFI's start: the spine item's index, the element and text
 * steps inside its document, and the character offset (0 when there is none). A range CFI
 * (parent, start, end) gives its start. Id assertions in brackets are dropped.
 */
export function parseCfi(cfi) {
  const inner = /^epubcfi\((.*)\)$/.exec(cfi ?? '')?.[1];
  if (!inner) return null;
  const [parent, start = ''] = inner.replace(/\[[^\]]*\]/g, '').split(',');
  const [spinePath, docPath = ''] = parent.split('!');
  const spineSteps = spinePath.split('/').filter(Boolean).map(Number);
  if (spineSteps.length < 2) return null;
  const [path, offset = '0'] = `${docPath}${start}`.split(':');
  const steps = path.split('/').filter(Boolean).map(Number);
  if ([...spineSteps, ...steps].some(Number.isNaN)) return null;
  return { spine: spineSteps.at(-1) / 2 - 1, steps, offset: Number(offset) || 0 };
}

/** Document order of two CFIs: spine item, then element and text steps, then offset (A4). */
export function compareCfi(a, b) {
  const x = parseCfi(a);
  const y = parseCfi(b);
  if (!x || !y) return 0;
  if (x.spine !== y.spine) return x.spine - y.spine;
  for (let i = 0; i < Math.min(x.steps.length, y.steps.length); i++) if (x.steps[i] !== y.steps[i]) return x.steps[i] - y.steps[i];
  return x.steps.length - y.steps.length || x.offset - y.offset;
}

/** A4's sortable integer for a PDF anchor: page * 1e6 + floor(y0) * 1e2 + floor(99 * x0 / width). */
export function pdfPosition(anchor, pageWidth) {
  const [x0, y0] = anchor.quads[0];
  return anchor.page * 1e6 + Math.floor(y0) * 1e2 + Math.floor((99 * x0) / pageWidth);
}

const PART = 1e6; // A4: the page or spine index above, the line and offset below
const xTerm = (x, width) => Math.min(99, Math.max(0, Math.floor((99 * x) / width)));

/**
 * A4 positions of a PDF range (C21.2): start from the first quad of its first page, end from the bottom-right of
 * the last quad of its last page. `widths` are the pages' widths in points, one per anchor. The server checks the
 * page and line parts against the anchors (backend/routers/annotations.py).
 */
export function pdfPositions(anchors, widths) {
  const [x0, y0] = anchors[0].quads[0];
  const last = anchors.at(-1);
  const [, , x1, y1] = last.quads.at(-1);
  return {
    start: anchors[0].page * PART + Math.max(0, Math.floor(y0)) * 1e2 + xTerm(x0, widths[0]),
    end: last.page * PART + Math.max(0, Math.floor(y1)) * 1e2 + xTerm(x1, widths.at(-1)),
  };
}

/** A4 positions of an EPUB range in spine item `spine`: the characters of its text before each end, capped. */
export function epubPositions(spine, startChar, endChar) {
  const cap = (n) => Math.min(PART - 1, Math.max(0, n));
  return { start: spine * PART + cap(startChar), end: spine * PART + cap(Math.max(startChar, endChar)) };
}

/** Reading order of two anchors of one book: PDF by page, then top, then left; EPUB by CFI. */
export function compareAnchors(a, b) {
  if (a.kind === 'epub') return compareCfi(a.cfi, b.cfi);
  const [ax, ay] = a.quads[0];
  const [bx, by] = b.quads[0];
  return a.page - b.page || ay - by || ax - bx;
}

const steps = (path) => path.split('/').filter(Boolean).map(Number);
const isPrefix = (prefix, of) => prefix.length <= of.length && prefix.every((s, i) => s === of[i]);
const before = (a, b) => { // element path a starts before b in document order
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i];
  return a.length <= b.length;
};

/**
 * The C12 block a CFI falls in (A6), from chunks.block_paths entries
 * { chunk_index, block_id, spine_index, path }: the deepest block whose element holds the
 * CFI, else the last block of its section that starts before it, else the section's first
 * block; null when the section has no blocks (a cover image) or the CFI does not parse.
 */
export function blockForCfi(cfi, blockPaths) {
  const at = parseCfi(cfi);
  if (!at) return null;
  const section = blockPaths.filter((b) => b.spine_index === at.spine);
  if (!section.length) return null;
  const holding = section.filter((b) => isPrefix(steps(b.path), at.steps));
  const found = holding.sort((a, b) => steps(b.path).length - steps(a.path).length)[0]
    ?? section.filter((b) => before(steps(b.path), at.steps)).at(-1)
    ?? section[0];
  return { chunk_index: found.chunk_index, block_id: found.block_id };
}
