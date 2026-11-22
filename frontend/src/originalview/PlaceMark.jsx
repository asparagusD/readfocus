import { useCallback, useEffect, useState } from 'react';

const GAP = 6; // px between the paper's edge and the mark, on the desk
const WIDTH = 12;

/**
 * The saved place's ribbon (C38.8b, issue 22: "we will keep our bookmark feature"): once the reader saves their place
 * (the toolbar's Save my place, or B), a small ribbon hangs beside it on the desk: from a PDF page's top, by its outer
 * edge, or beside the line of an EPUB's column. The renderer places it as it places a note's marker
 * (`noteSpots`, for one note anchored at `mark`), again on a scroll, a resize or a new `layout`. Decorative: the
 * toast says where the place was saved.
 */
export function PlaceMark({ book, box, mark, hidden, layout }) {
  const [spot, setSpot] = useState(null);
  const measure = useCallback(() => {
    if (!box || hidden || !mark) { setSpot(null); return; }
    const within = box.getBoundingClientRect();
    const [at] = book.current?.noteSpots?.([{ id: 'mark', anchors: [mark] }], within) ?? [];
    if (!at) { setSpot(null); return; }
    const edge = (at.edge ?? within.right - GAP - WIDTH) - within.left;
    const x = Math.round(Math.max(0, Math.min(at.side === 'left' ? edge - GAP - WIDTH : edge + GAP, within.width - WIDTH - 4)));
    const top = Math.round(at.top - within.top);
    setSpot((now) => (now?.x === x && now?.top === top ? now : { x, top }));
  }, [book, box, mark, hidden]);

  useEffect(() => {
    let frame = requestAnimationFrame(measure);
    const later = [250, 800].map((ms) => setTimeout(measure, ms)); // pages draw and sections lay out after a move
    const again = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(again);
    if (box) resize.observe(box);
    box?.addEventListener('scroll', again, true);
    return () => {
      cancelAnimationFrame(frame);
      later.forEach(clearTimeout);
      resize.disconnect();
      box?.removeEventListener('scroll', again, true);
    };
  }, [measure, box, layout]);

  if (!spot) return null;
  return <span className="rf-ov-mark" style={{ left: `${spot.x}px`, top: `${spot.top}px` }} aria-hidden="true" />;
}
