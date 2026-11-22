import { useCallback, useEffect, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { layoutMarkers } from '../notes/markers';

const NARROW = 760;
const GAP = 6; // px from a PDF page's edge, as the note markers
const INSET = 10; // px from an EPUB page's edge
const EDGE = 20; // px kept clear at the view's right edge
const PREVIEW = 240; // px, the preview's width

/**
 * Comment markers (C39.8, issue 23, D1): a comment icon in the page's margin beside each highlight with a comment, as
 * Edge's, placed through the renderer's `noteSpots` like the note markers, which (and the saved place's mark) it keeps
 * clear of. Hovering or focusing one previews its comment; a click or Enter edits it (`onEdit(id)`). Drawn again when
 * the place, the comments, the size, the zoom or the text size change, and when a zoomed PDF scrolls.
 */
export function CommentMarkers({ book, box, annotations, hidden, wide, layout, onEdit }) {
  const [markers, setMarkers] = useState([]);
  const [shown, setShown] = useState(null); // the marker whose preview is open
  const commented = annotations?.filter((a) => a.comment && !a.pending) ?? [];
  const key = commented.map((a) => `${a.id}:${a.comment}`).join('|');
  const measure = useCallback(() => {
    if (!box || hidden || !commented.length) { setMarkers([]); return; }
    const within = box.getBoundingClientRect();
    const narrow = window.innerWidth < NARROW;
    const size = narrow ? 22 : 26;
    const spots = (book.current?.noteSpots?.(commented, within) ?? []).map((spot) => {
      const top = spot.top - within.top + Math.min(spot.height || 0, size) / 2 - size / 2;
      if (narrow) return { id: spot.id, side: 'right', x: within.width - size - 4, top };
      if (spot.edge !== undefined) {
        const x = spot.side === 'left' ? spot.edge - within.left - GAP - size : spot.edge - within.left + GAP;
        return { id: spot.id, side: spot.side, x: Math.max(4, Math.min(x, within.width - size - EDGE)), top };
      }
      const side = spot.side ?? 'right';
      return { id: spot.id, side, x: side === 'left' ? INSET : within.width - INSET - size, top };
    });
    const obstacles = [...box.querySelectorAll('.rf-note-marker, .rf-ov-mark')].map((el) => {
      const r = el.getBoundingClientRect();
      return { side: r.left - within.left < within.width / 2 ? 'left' : 'right', top: r.top - within.top, bottom: r.bottom - within.top,
        left: r.left - within.left, right: r.right - within.left };
    });
    const laid = layoutMarkers(spots, { size, obstacles }).filter((m) => m.top >= 0 && m.top + size <= within.height)
      .map((m) => ({ ...m, size }));
    setMarkers((now) => (JSON.stringify(now) === JSON.stringify(laid) ? now : laid));
  }, [book, box, hidden, key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` stands for the comments

  useEffect(() => {
    let frame = requestAnimationFrame(measure);
    const later = [300, 900].map((ms) => setTimeout(measure, ms)); // after the note markers and the pages settle
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
  const textOf = (ids) => ids.map((id) => commented.find((a) => a.id === id)?.comment).filter(Boolean);
  return markers.map((m) => {
    const id = `rf-comment-preview-${m.ids[0]}`;
    const texts = textOf(m.ids);
    const open = shown === m.ids.join();
    return [
      <button key={`c-${m.ids.join()}`} type="button" className="rf-comment-marker" data-no-lookup data-side={m.side}
        style={{ left: `${m.x}px`, top: `${m.top}px`, width: m.size, height: m.size }}
        aria-label={`Comment: ${texts.join(' / ')}. Edit`} aria-describedby={open ? id : undefined}
        onPointerEnter={() => setShown(m.ids.join())} onPointerLeave={() => setShown(null)}
        onFocus={() => setShown(m.ids.join())} onBlur={() => setShown(null)}
        onPointerDown={(event) => event.stopPropagation()} onClick={() => { setShown(null); onEdit(m.ids[0]); }}>
        <MessageSquareText size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>,
      open && (
        <div key={`p-${m.ids.join()}`} id={id} role="tooltip" className="rf-comment-preview" data-no-lookup
          style={{ left: `${Math.max(4, m.x + m.size - PREVIEW)}px`, top: `${m.top + m.size + 6}px`, width: PREVIEW }}>
          {texts.map((t, i) => <p key={i}>{t}</p>)}
        </div>
      ),
    ];
  });
}
