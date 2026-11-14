import { useCallback, useEffect, useState } from 'react';
import { layoutMarkers, markerLabel } from './markers';
import './MarginMarkers.css';

const NARROW = 760; // the side panel becomes a sheet below this too
const GAP = 6; // px between a PDF page's edge and its marker, in the frame margin: inside the ribbon's tail
const INSET = 10; // px from an EPUB page's edge, in the page margin

/**
 * Margin markers (C22.4, handoff screen 19): a count circle beside each passage with notes on the pages shown,
 * in the outer frame margin of a PDF page or the page margin of an EPUB, 22 px at the right edge on a phone.
 * The renderer measures (`noteSpots(notes, within)`: { id, top, height, side?, edge? } on screen); markers.js
 * groups and spaces them. Drawn again when the place, the notes, the size, the zoom or the text size change,
 * and when a zoomed PDF scrolls. A click calls onOpen(ids).
 */
export function MarginMarkers({ book, box, notes, hidden, wide, layout, onOpen }) {
  const [markers, setMarkers] = useState([]);
  const measure = useCallback(() => {
    if (!box || hidden || !notes?.length) { setMarkers([]); return; }
    const within = box.getBoundingClientRect();
    const narrow = window.innerWidth < NARROW;
    const size = narrow ? 22 : 26;
    const spots = (book.current?.noteSpots?.(notes, within) ?? []).map((spot) => {
      const top = spot.top - within.top + Math.min(spot.height || 0, size) / 2 - size / 2;
      if (narrow) return { id: spot.id, side: 'right', x: within.width - size - 4, top };
      if (spot.edge !== undefined) {
        const x = spot.side === 'left' ? spot.edge - within.left - GAP - size : spot.edge - within.left + GAP;
        return { id: spot.id, side: spot.side, x, top };
      }
      const side = spot.side ?? 'right';
      return { id: spot.id, side, x: side === 'left' ? INSET : within.width - INSET - size, top };
    });
    const tail = box.querySelector('.rf-ov-ribbon-tail')?.getBoundingClientRect();
    const obstacles = tail ? [{ side: 'right', top: tail.top - within.top, bottom: tail.bottom - within.top,
      left: tail.left - within.left, right: tail.right - within.left }] : [];
    const laid = layoutMarkers(spots, { size, obstacles }).filter((m) => m.top >= 0 && m.top + size <= within.height);
    setMarkers((now) => (JSON.stringify(now) === JSON.stringify(laid) ? now : laid));
  }, [book, box, notes, hidden]);

  useEffect(() => {
    let frame = requestAnimationFrame(measure);
    const later = [250, 800].map((ms) => setTimeout(measure, ms)); // pages draw and sections lay out after the move
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
  }, [measure, box, wide, layout]);

  if (hidden) return null;
  return markers.map((m) => (
    <button key={`${m.side}-${m.ids.join()}`} type="button" className="rf-note-marker" data-no-lookup data-side={m.side}
      style={{ left: `${m.x}px`, top: `${m.top}px` }} aria-label={markerLabel(m.ids.length)} title={markerLabel(m.ids.length)}
      onPointerDown={(event) => event.stopPropagation()} onClick={() => onOpen(m.ids)}>
      <span aria-hidden="true">{m.ids.length}</span>
    </button>
  ));
}
