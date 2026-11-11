import { useCallback, useEffect, useRef, useState } from 'react';

const GRACE_MS = 200; // pointer may cross the gap between the word and the card
const NEAR_PX = 4;

const near = (range, x, y) => [...range.getClientRects()].some((r) =>
  x >= r.left - NEAR_PX && x <= r.right + NEAR_PX && y >= r.top - NEAR_PX && y <= r.bottom + NEAR_PX);

/**
 * The card's state and its closing rules (C12.8). open() starts the fetch at once (the hover
 * intent has already been shown); hover-opened cards close 200 ms after the pointer leaves both
 * the word and the card; any card closes on Esc, a press elsewhere or close(). Only a card opened
 * from the keyboard takes focus, and closing it returns focus to the book.
 */
export function useWordCard({ client, returnFocusTo, onClosed }) {
  const [card, setCard] = useState(null); // { id, target, state, by: 'hover' | 'select' | 'key' }
  const cardRef = useRef(null);
  const grace = useRef(0);
  const closed = useRef(onClosed);
  useEffect(() => { closed.current = onClosed; }, [onClosed]);

  const close = useCallback((returnFocus = false) => {
    clearTimeout(grace.current);
    setCard(null);
    closed.current?.();
    if (returnFocus) returnFocusTo.current?.focus();
  }, [returnFocusTo]);

  const open = useCallback((target, by) => {
    clearTimeout(grace.current);
    const id = `${target.kind}:${target.term}:${Date.now()}`;
    setCard((prev) => (prev && prev.target.term === target.term && prev.target.kind === target.kind
      ? { ...prev, by: by === 'key' ? 'key' : prev.by } // the same target again, e.g. Enter on an open phrase
      : { id, target, by, state: { status: 'loading' } }));
    client.get(target).then((state) => {
      if (state.status === 'aborted') return;
      setCard((prev) => (prev && prev.target.term === target.term ? { ...prev, state } : prev));
    });
  }, [client]);

  const open_ = Boolean(card);
  const hoverOnly = card?.by === 'hover';
  const range = card?.target.range;
  useEffect(() => {
    if (!open_) return undefined;
    const onMove = (event) => {
      if (!hoverOnly) return;
      const inside = cardRef.current?.contains(event.target) || near(range, event.clientX, event.clientY);
      clearTimeout(grace.current);
      if (!inside) grace.current = setTimeout(() => close(false), GRACE_MS);
    };
    const onDown = (event) => {
      if (!cardRef.current?.contains(event.target)) close(false);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(cardRef.current?.contains(document.activeElement) ?? false);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(grace.current);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open_, hoverOnly, range, close]);

  return { card, open, close, cardRef };
}
