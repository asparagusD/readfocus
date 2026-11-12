// The soft mark on the word being looked up (C12.7). The CSS Custom Highlight API paints it
// without touching the DOM; where that API is missing, plain boxes are drawn in a layer that
// sits under the text, so the book's markup is never changed either way.

const NAME = 'rf-lookup';

export const highlightSupported = () => typeof CSS !== 'undefined' && Boolean(CSS.highlights) && typeof Highlight === 'function';

/** Mark range; layer is the fallback's container (positioned, under the text). */
export function showHighlight(range, layer) {
  if (highlightSupported()) {
    CSS.highlights.set(NAME, new Highlight(range));
    return;
  }
  if (!layer) return;
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
  if (highlightSupported()) CSS.highlights.delete(NAME);
  layer?.replaceChildren();
}
