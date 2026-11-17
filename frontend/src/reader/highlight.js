// The soft mark on the word being looked up (C12.7). The CSS Custom Highlight API paints it
// without touching the DOM; where that API is missing, plain boxes are drawn in a layer that
// sits under the text, so the book's markup is never changed either way. Since C17.5 the word
// can be in another document (an EPUB section's iframe): the mark goes in that document's
// registry, with the page's --accent-soft copied in, and the card is placed by outerBox.

const NAME = 'rf-lookup';
const STYLE = 'data-rf-lookup';

export const highlightSupported = (win = globalThis) => typeof win.CSS !== 'undefined' && Boolean(win.CSS?.highlights) && typeof win.Highlight === 'function';

let marked = null; // the window whose registry holds the mark

/** The ::highlight rule inside a section's document, in the reading page's current colour. */
function styleIn(doc) {
  if (doc === document) return;
  let style = doc.head?.querySelector(`style[${STYLE}]`);
  if (!style) {
    style = doc.createElement('style');
    style.setAttribute(STYLE, '');
    doc.head?.append(style);
  }
  const soft = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim() || 'rgba(180, 120, 40, 0.25)';
  style.textContent = `::highlight(${NAME}) { background-color: ${soft}; }`;
}

/** Mark range; layer is the fallback's container (positioned, under the text) in this page. */
export function showHighlight(range, layer) {
  const doc = range.startContainer.ownerDocument ?? document;
  const win = doc.defaultView ?? globalThis;
  if (highlightSupported(win)) {
    clearHighlight(layer);
    styleIn(doc);
    win.CSS.highlights.set(NAME, new win.Highlight(range));
    marked = win;
    return;
  }
  if (!layer || doc !== document) return;
  const origin = layer.getBoundingClientRect();
  const boxes = [...range.getClientRects()].map((r) => {
    const box = document.createElement('span');
    box.className = 'rf-mark';
    Object.assign(box.style, {
      left: `${r.left - origin.left}px`, top: `${r.top - origin.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    });
    return box;
  });
  layer.replaceChildren(...boxes);
}

export function clearHighlight(layer) {
  try {
    if (marked && highlightSupported(marked)) marked.CSS.highlights.delete(NAME);
  } catch { /* the section's document is gone */ }
  marked = null;
  if (highlightSupported()) CSS.highlights.delete(NAME);
  layer?.replaceChildren();
}

/**
 * A range's boxes in this page's coordinates (C17.5): a word in an EPUB section's iframe is
 * shifted by the iframe's place, so the card and chip sit beside it in the outer frame.
 */
export function outerBox(range) {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement ?? null;
  const shift = (r) => {
    if (!frame) return r;
    const f = frame.getBoundingClientRect();
    return new DOMRect(r.x + f.x, r.y + f.y, r.width, r.height);
  };
  return {
    getBoundingClientRect: () => shift(range.getBoundingClientRect()),
    getClientRects: () => [...range.getClientRects()].map(shift),
    contextElement: frame ?? range.startContainer.parentElement ?? undefined,
  };
}
