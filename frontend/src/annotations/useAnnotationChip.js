import { useEffect, useRef, useState } from 'react';
import { annotationAt } from './hover';

const GRACE_MS = 250; // the pointer may cross the gap between the highlight and the chip
const TAP_PX = 10;
const TAP_MS = 500;

/**
 * Which annotation's chip is open (C21.4), and why: { id, by: 'hover' | 'tap' | 'key' }. With `active` (word
 * lookup off, the book still), a mouse resting on a drawn annotation opens it and leaving both closes it after a
 * short grace; a tap opens it; a press elsewhere closes it. Events come from this page: an EPUB section's are
 * relayed to it in page coordinates (Reader.jsx). `entries()` is where each annotation is drawn; `chip` the chip's
 * element; `blocked` (a live selection) keeps it shut.
 */
export function useAnnotationChip({ entries, chip, active, blocked }) {
  const [open, setOpen] = useState(null);
  const current = useRef(null);
  const grace = useRef(0);
  const frame = useRef(0);
  const press = useRef(null);
  const stay = () => { clearTimeout(grace.current); grace.current = 0; };
  const show = (next) => {
    stay();
    current.current = next;
    setOpen(next);
  };
  const close = () => show(null);
  const showRef = useRef(show);
  const entriesRef = useRef(entries);
  const stayRef = useRef(stay);
  useEffect(() => { showRef.current = show; entriesRef.current = entries; stayRef.current = stay; });

  useEffect(() => {
    if (!active || blocked) return undefined;
    const onChip = (event) => chip.current?.contains(event.target);
    const at = (event) => annotationAt(entriesRef.current(), event.clientX, event.clientY);
    const move = (event) => {
      if (event.pointerType === 'touch' || event.buttons) return;
      if (onChip(event)) { stayRef.current(); return; }
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const id = at(event);
        const now = current.current;
        if (id) {
          if (now?.id === id) stayRef.current();
          else if (!now || now.by === 'hover') showRef.current({ id, by: 'hover' }); // a tapped or keyed chip stays
        } else if (now?.by === 'hover' && !grace.current) { // moving on outside does not restart the grace
          grace.current = setTimeout(() => { if (current.current?.by === 'hover') showRef.current(null); }, GRACE_MS);
        }
      });
    };
    const down = (event) => {
      press.current = { x: event.clientX, y: event.clientY, at: Date.now(), touch: event.pointerType === 'touch' };
      if (current.current && !onChip(event)) showRef.current(null); // a press elsewhere puts it away
    };
    const up = (event) => {
      const start = press.current;
      press.current = null;
      if (!start?.touch || Date.now() - start.at > TAP_MS) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_PX) return;
      const id = at(event);
      if (id) showRef.current({ id, by: 'tap' });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    return () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(grace.current);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
    };
  }, [active, blocked, chip]);

  return { open: active && !blocked ? open : null, show, close };
}
