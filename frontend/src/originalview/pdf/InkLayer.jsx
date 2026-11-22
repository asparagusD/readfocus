import { useRef } from 'react';
import { addPoint, ERASER_PX, pagePoint, quadsHit, strokeHit, strokePath, sweep } from '../../annotations/ink';

/**
 * Ink on one PDF page (C39.4, issue 23): an SVG over the text layer whose user space is the page's PDF points
 * (viewBox), so a stroke drawn at one zoom lies on the same words at any other. `marks` are this page's ink strokes.
 * With Draw on (`ink`: { colour, width, onStroke(page, points) }) it takes the pointer: a press starts a stroke (a pen's
 * pressure kept, a mouse or finger at 0.5), each move adds a point (coalesced moves too), the lift hands the stroke
 * over to be saved; the stroke in progress is drawn straight into its path, with no render per move. With Draw off
 * the pointer passes through to the text below, so selection and Look up work as before.
 * By touch one finger draws and two scroll the book (a second finger drops the stroke begun by the first).
 * C39.5: Edge's eraser (`eraser`: { on, onHit({ marks, annotations }), onDone() }): with Erase on, or a pen's eraser
 * end while Draw is on, a drag takes away each whole stroke and highlight (`highlights`, this page's) it passes within
 * 8 screen px of, at once; the drag's end lets the session offer one Undo for all of them.
 */
export function InkLayer({ page, size, marks, ink, highlights = [], eraser = null }) {
  const svg = useRef(null);
  const live = useRef(null);
  const stroke = useRef(null); // { id, points } while drawing
  const touches = useRef(new Map()); // touch pointer id -> { x, y }
  const pan = useRef(null); // { x, y } of two fingers while they scroll
  const rubbing = useRef(null); // { id, last, gone: Set } while erasing
  const w = size.width / size.scale;
  const h = size.height / size.scale;

  const pointOf = (event) => pagePoint(event.clientX, event.clientY, svg.current.getBoundingClientRect(), size.scale,
    event.pointerType === 'pen' ? event.pressure : 0.5, { width: w, height: h });
  const show = () => live.current?.setAttribute('d', strokePath({ points: stroke.current.points, width: ink.width }));
  const end = (keep) => {
    const done = stroke.current;
    stroke.current = null;
    live.current?.setAttribute('d', '');
    if (keep && done?.points.length) ink.onStroke(page, done.points);
  };

  const middle = () => {
    const all = [...touches.current.values()];
    return { x: all.reduce((n, t) => n + t.x, 0) / all.length, y: all.reduce((n, t) => n + t.y, 0) / all.length };
  };
  const lift = (event) => {
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pan.current = null;
  };

  const rub = (to) => { // the eraser from where it was to `to`: whatever it passes over goes
    const r = ERASER_PX / size.scale;
    const { gone } = rubbing.current;
    const hit = { marks: [], annotations: [] };
    for (const p of sweep(rubbing.current.last ?? to, to, r)) {
      for (const m of marks) if (!gone.has(m.id) && strokeHit(m.data, p, r)) { gone.add(m.id); hit.marks.push(m.id); }
      for (const a of highlights) {
        if (gone.has(a.id) || !a.anchors.some((x) => x.page === page && quadsHit(x.quads, p, r))) continue;
        gone.add(a.id);
        hit.annotations.push(a.id);
      }
    }
    rubbing.current.last = to;
    if (hit.marks.length || hit.annotations.length) eraser.onHit(hit);
  };
  const penEraser = (event) => event.pointerType === 'pen' && ((event.buttons & 32) || event.button === 5);
  const stopRubbing = (event) => {
    if (rubbing.current?.id !== event.pointerId) return false;
    rubbing.current = null;
    eraser.onDone();
    return true;
  };

  const handlers = (ink || eraser?.on) && {
    onPointerDown: (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault(); // no text selection while drawing
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* a pointer the browser no longer has: draw uncaptured */ }
      if (eraser && (eraser.on || penEraser(event))) {
        rubbing.current = { id: event.pointerId, last: null, gone: new Set() };
        rub(pointOf(event));
        return;
      }
      if (event.pointerType === 'touch') {
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.current.size >= 2) { // two fingers scroll: the first one's stroke is dropped
          if (stroke.current) end(false);
          pan.current = middle();
          return;
        }
      }
      if (stroke.current) return;
      stroke.current = { id: event.pointerId, points: [pointOf(event)] };
      show();
    },
    onPointerMove: (event) => {
      if (rubbing.current?.id === event.pointerId) {
        rub(pointOf(event));
        return;
      }
      if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pan.current) {
        const now = middle();
        svg.current?.closest('.rf-pdf-book')?.scrollBy({ left: pan.current.x - now.x, top: pan.current.y - now.y });
        pan.current = now;
        return;
      }
      if (stroke.current?.id !== event.pointerId) return;
      const moves = event.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const move of moves.length ? moves : [event]) stroke.current.points = addPoint(stroke.current.points, pointOf(move));
      show();
    },
    onPointerUp: (event) => {
      lift(event);
      if (stopRubbing(event)) return;
      if (stroke.current?.id === event.pointerId) end(true);
    },
    onPointerCancel: (event) => {
      lift(event);
      if (stopRubbing(event)) return;
      if (stroke.current?.id === event.pointerId) end(false);
    },
  };

  if (!ink && !eraser?.on && !marks.length) return null;
  return (
    <svg ref={svg} className="rf-ink" data-theme="paper" data-drawing={ink || eraser?.on ? true : undefined}
      data-erasing={eraser?.on || undefined} viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none" aria-hidden="true" {...handlers}>
      {marks.map((m) => <path key={m.id} data-id={m.id} data-mark-colour={m.color} d={strokePath(m.data)} />)}
      {ink && <path ref={live} className="rf-ink-live" data-mark-colour={ink.colour} />}
    </svg>
  );
}
