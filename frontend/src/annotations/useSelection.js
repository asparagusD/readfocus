import { useEffect, useRef, useState } from 'react';

const SETTLE_MS = 150; // a selection still moving under a handle or Shift+arrow is not shown yet
const NOT_PROSE = 'math, pre, code, figure, table, svg';

const keyOf = (anchors) => anchors.map((a) => a.cfi ?? `${a.page}:${a.quads.flat().join(',')}`).join('|');

/**
 * The settled text selection in the book (C21.2): the renderer's `selectionPlace()` ({anchors, start, end, range,
 * doc}) once the mouse is up and the selection has stopped moving, in the page (`docs` holds `document` for a PDF)
 * or in any EPUB section's document. `place.touch` says it was made by touch, `place.prose` that it starts in
 * running text (ANCHORS A8: underline only there); `skipAt(x, y)` marks a PDF point in math, code or a figure.
 * `dismiss()` hides it until the selection changes or a new press starts.
 */
export function useSelection({ book, docs, paused, skipAt }) {
  const [place, setPlace] = useState(null);
  const pressing = useRef(false);
  const pointer = useRef('mouse');
  const dismissed = useRef(null);
  const timer = useRef(0);

  const read = () => {
    const found = book.current?.selectionPlace?.();
    if (!found || !found.anchors.length || found.anchors.some((a) => !a.text)) {
      dismissed.current = null;
      setPlace(null);
      return;
    }
    const key = keyOf(found.anchors);
    if (dismissed.current === key) return;
    const start = found.range.startContainer;
    const element = start.nodeType === 1 ? start : start.parentElement;
    const first = found.range.getClientRects()[0];
    const prose = !element?.closest?.(NOT_PROSE) && !(first && skipAt?.(first.left + 1, first.top + first.height / 2));
    setPlace((now) => (now?.key === key ? now : { ...found, key, prose, touch: pointer.current === 'touch' }));
  };

  const readRef = useRef(read);
  useEffect(() => { readRef.current = read; });

  useEffect(() => {
    const later = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (!pressing.current) readRef.current(); }, SETTLE_MS);
    };
    const down = (event) => { // a new press is a new selection: one put away before may show again
      pressing.current = event.pointerType !== 'touch';
      pointer.current = event.pointerType || 'mouse';
      dismissed.current = null;
    };
    const up = () => { pressing.current = false; later(); };
    for (const doc of docs) {
      doc.addEventListener('selectionchange', later);
      doc.addEventListener('pointerdown', down, true);
      doc.addEventListener('pointerup', up, true);
    }
    return () => {
      clearTimeout(timer.current);
      for (const doc of docs) {
        doc.removeEventListener('selectionchange', later);
        doc.removeEventListener('pointerdown', down, true);
        doc.removeEventListener('pointerup', up, true);
      }
    };
  }, [docs]);

  // Escape and Ask Steve keep the selection and put the toolbar away until it changes; a saved colour clears
  // the selection itself (`remember` false), so the same words selected again at once show it again.
  const dismiss = (remember = true) => {
    dismissed.current = remember ? place?.key ?? null : null;
    setPlace(null);
  };

  return { place: paused ? null : place, dismiss }; // a page turn collapses the selection anyway
}
