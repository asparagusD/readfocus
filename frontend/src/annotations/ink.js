// Ink on a PDF page (C39.4, issue 23; docs/ANCHORS.md A12), pure, so it runs under node --test. A stroke is kept in
// PDF points from the page's top-left ([x, y, pressure]), so zoom and Page view only rescale it. It is drawn as a
// filled outline whose width follows a pen's pressure (a mouse or a finger reports 0.5: an even line), smoothed
// through the midpoints of its sides, and a tap is a dot.

export const MIN_STEP = 0.75; // points: a move shorter than this adds no point (a still hand, a jittery pen)
export const MAX_POINTS = 2_000; // as the server's policy.MARK_STROKE_POINTS_MAX
export const MAX_COORD = 9_999; // A4's line limit, as the server's MARK_COORD_MAX (exclusive)
export const WIDTHS = [1, 2, 3, 4, 6, 8, 12]; // Draw's thickness choices, in points
export const DEFAULT_INK = { colour: 'ink', width: 2 };

const round = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** A pointer at client (x, y) as a page point: `box` is the page's client rect, `scale` CSS px per point. */
export function pagePoint(x, y, box, scale, pressure = 0.5, size = null) {
  const w = size?.width ?? box.width / scale;
  const h = size?.height ?? box.height / scale;
  return [
    round(clamp((x - box.left) / scale, 0, Math.min(w, MAX_COORD))),
    round(clamp((y - box.top) / scale, 0, Math.min(h, MAX_COORD))),
    round(clamp(Number.isFinite(pressure) ? pressure : 0.5, 0, 1)),
  ];
}

/** `points` with `next` added, unless it is within MIN_STEP of the last one or the stroke is full. */
export function addPoint(points, next) {
  const last = points.at(-1);
  if (points.length >= MAX_POINTS) return points;
  if (last && Math.hypot(next[0] - last[0], next[1] - last[1]) < MIN_STEP) return points;
  return [...points, next];
}

/** A point's half-width: `width` at a pressure of 0.5, thinner or fuller with a pen's lighter or firmer touch. */
export const halfWidth = (width, pressure) => (width * clamp(0.4 + 1.2 * pressure, 0.4, 1.6)) / 2;

const fmt = (n) => String(round(n));

/** An SVG path (in points) for a stroke `{ points, width }`: a filled outline, or a circle for a single point. */
export function strokePath({ points, width }) {
  if (!points.length) return '';
  if (points.length === 1) {
    const [x, y, p] = points[0];
    const r = halfWidth(width, p);
    return `M${fmt(x - r)} ${fmt(y)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`;
  }
  const left = [];
  const right = [];
  points.forEach(([x, y, p], i) => {
    const [ax, ay] = points[Math.max(0, i - 1)];
    const [bx, by] = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const r = halfWidth(width, p);
    left.push([x + nx * r, y + ny * r]);
    right.push([x - nx * r, y - ny * r]);
  });
  const side = (pts) => pts.slice(1).map((pt, i) => {
    const [px, py] = pts[i];
    return `Q${fmt(px)} ${fmt(py)} ${fmt((px + pt[0]) / 2)} ${fmt((py + pt[1]) / 2)}`;
  }).join('') + `L${fmt(pts.at(-1)[0])} ${fmt(pts.at(-1)[1])}`;
  const back = right.reverse();
  const end = halfWidth(width, points.at(-1)[2]);
  const start = halfWidth(width, points[0][2]);
  return `M${fmt(left[0][0])} ${fmt(left[0][1])}${side(left)}`
    + `A${fmt(end)} ${fmt(end)} 0 0 1 ${fmt(back[0][0])} ${fmt(back[0][1])}${side(back)}`
    + `A${fmt(start)} ${fmt(start)} 0 0 1 ${fmt(left[0][0])} ${fmt(left[0][1])}Z`;
}

/** Draw's colour and thickness, kept on this device; the defaults when nothing (or nonsense) is stored. */
const KEY = 'rf-ink';
export function readInk(colours, store = globalThis.localStorage) {
  try {
    const stored = JSON.parse(store?.getItem(KEY) ?? 'null');
    return {
      colour: colours.includes(stored?.colour) ? stored.colour : DEFAULT_INK.colour,
      width: WIDTHS.includes(stored?.width) ? stored.width : DEFAULT_INK.width,
    };
  } catch {
    return { ...DEFAULT_INK };
  }
}
export function storeInk(ink, store = globalThis.localStorage) {
  try { store?.setItem(KEY, JSON.stringify(ink)); } catch { /* private mode: the defaults come back next time */ }
}

/** The POST /books/{id}/marks body for a finished stroke on `page`. */
export const newStroke = (page, points, ink) => ({ kind: 'ink', page, color: ink.colour, data: { points, width: ink.width } });

export const BLOCK = 20; // C39.4: a book's marks are loaded 20 pages at a time (usePageMarks)

/** The 20-page blocks (0 for pages 1-20) covering `pages` and two pages either side. */
export function blocksFor(pages) {
  if (!pages?.length) return [];
  const first = Math.max(1, Math.min(...pages) - 2);
  const last = Math.max(...pages) + 2;
  const out = [];
  for (let b = Math.floor((first - 1) / BLOCK); b <= Math.floor((last - 1) / BLOCK); b += 1) out.push(b);
  return out;
}
