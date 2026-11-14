// Drawing highlights and underlines (C21.3, docs/ANCHORS.md A5): which annotations a page or section shows, a PDF
// page's boxes from the anchors' quads, and the ::highlight rules an EPUB section document gets. Pure, so it runs
// under node --test; the DOM side is PdfPage.jsx (a layer of boxes) and epubPaint.js (CSS Custom Highlights).
import { parseCfi } from '../anchors/index.js';
import { COLOURS } from './palette.js';

const UNDERLINE_PX = 2; // handoff: underlines are a 2 px line in the colour's hue
const round = (n) => Math.round(n * 100) / 100;

/** The ::highlight name for an annotation's style and colour, e.g. 'rf-highlight-sky'. */
export const highlightName = ({ style, color }) => `rf-${style}-${color}`;

/** PDF annotations with a page among `pages` or one either side (only those pages are drawn). */
export function forPages(annotations, pages) {
  if (!pages.length) return [];
  const [first, last] = [Math.min(...pages) - 1, Math.max(...pages) + 1];
  return annotations.filter((a) => a.anchors?.some((x) => x.kind === 'pdf' && x.page >= first && x.page <= last));
}

/** EPUB annotations whose range lies in spine item `index`. */
export const forSpine = (annotations, index) =>
  annotations.filter((a) => a.anchors?.some((x) => x.kind === 'epub' && parseCfi(x.cfi)?.spine === index));

/**
 * The boxes on PDF page `page` drawn at `scale` CSS px per point: a highlight covers each quad; an underline is a
 * 2 px bar along each quad's bottom. Keys are stable per annotation and quad.
 */
export function pdfBoxes(annotations, page, scale) {
  const out = [];
  for (const a of annotations) {
    for (const anchor of a.anchors ?? []) {
      if (anchor.kind !== 'pdf' || anchor.page !== page) continue;
      anchor.quads.forEach(([x0, y0, x1, y1], i) => {
        const under = a.style === 'underline';
        out.push({
          key: `${a.id}:${i}`, id: a.id, style: a.style, color: a.color, left: round(x0 * scale), top: round((under ? y1 : y0) * scale),
          width: round((x1 - x0) * scale), height: under ? UNDERLINE_PX : round((y1 - y0) * scale),
        });
      });
    }
  }
  return out;
}

/** The rules a section document needs: each colour's highlight behind the text and its 2 px underline. */
export function highlightCss({ hl, ul }) {
  return COLOURS.filter((c) => hl[c] || ul[c]).map((c) => [
    hl[c] && `::highlight(rf-highlight-${c}) { background-color: ${hl[c]}; }`,
    ul[c] && `::highlight(rf-underline-${c}) { text-decoration: underline ${UNDERLINE_PX}px ${ul[c]}; }`,
  ].filter(Boolean).join('\n')).join('\n');
}
