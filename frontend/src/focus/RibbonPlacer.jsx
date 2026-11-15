import { useEffect, useRef, useState } from 'react';
import { pageForX } from './bookmark';
import './RibbonPlacer.css';

/**
 * Setting focus mode's bookmark (C23.6b, handoff screen 22 "Placing"): a hint bar over the book ("Drag the
 * ribbon to the page where you stopped.") with "Set ribbon on p. N" for each page shown and Cancel, and a larger
 * ribbon to drag onto a page. Turning pages still works, so the ribbon can go on any page. Keyboard: the arrows
 * choose a page shown, Enter sets the ribbon there, Escape cancels. `load()` gives [{ anchor, label }] for the
 * pages shown; it is asked again whenever `placeKey` (the place shown) changes.
 */
export function RibbonPlacer({ load, placeKey, onSet, onCancel }) {
  const [places, setPlaces] = useState([]);
  const [pick, setPick] = useState(null);
  const [drag, setDrag] = useState(null); // { x0, dx } while the ribbon is held
  const ribbon = useRef(null);

  useEffect(() => {
    let live = true;
    load().then((found) => { if (live) setPlaces(found ?? []); }).catch(() => {});
    return () => { live = false; };
  }, [load, placeKey]);
  useEffect(() => { ribbon.current?.focus({ preventScroll: true }); }, []);

  const target = Math.min(pick ?? places.length - 1, places.length - 1);
  const chosen = places[target];

  const onKeyDown = (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation(); // the arrows choose a page here; they do not turn one
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      setPick(Math.min(places.length - 1, Math.max(0, target + step)));
    } else if ((event.key === 'Enter' || event.key === ' ') && chosen) {
      event.preventDefault();
      onSet(chosen);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };
  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ x0: event.clientX, dx: 0 });
  };
  const onPointerMove = (event) => { if (drag) setDrag({ ...drag, dx: event.clientX - drag.x0 }); };
  const onPointerUp = (event) => {
    if (!drag) return;
    const stage = event.currentTarget.closest('.rf-ov-stage')?.getBoundingClientRect();
    setDrag(null);
    if (!stage || !places.length) return;
    onSet(places[pageForX(event.clientX, stage, places.length)]);
  };

  return (
    <>
      <div className="rf-placing" role="group" aria-label="Place the ribbon" data-no-lookup>
        <p className="rf-placing-hint">Drag the ribbon to the page where you stopped.</p>
        <div className="rf-placing-actions">
          {places.map((p, i) => (
            <button key={`${p.label}-${i}`} type="button" className="rf-placing-button" data-picked={i === target || undefined}
              onClick={() => onSet(p)}>
              Set ribbon on {p.label}
            </button>
          ))}
          <button type="button" className="rf-placing-button rf-placing-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
      <button type="button" ref={ribbon} className="rf-ov-ribbon rf-ov-ribbon--placing" data-dragging={drag ? 'true' : undefined}
        aria-label={chosen ? `Ribbon, on ${chosen.label}. Arrow keys choose a page, Enter sets it.` : 'Ribbon'}
        style={drag ? { transform: `translateX(${drag.dx}px)` } : undefined}
        onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}>
        <span className="rf-ov-ribbon-tail" aria-hidden="true" />
      </button>
    </>
  );
}
