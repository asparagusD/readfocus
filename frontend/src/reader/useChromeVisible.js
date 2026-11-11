import { useCallback, useEffect, useRef, useState } from 'react';

const IDLE_MS = 2600; // handoff: the toolbar fades after 2.6 s without pointer movement

/**
 * Whether the reader's chrome is shown: on at first, on mouse movement or a
 * tap anywhere, and while `hold` (focus inside, a drawer open); off after
 * IDLE_MS of stillness. Keys that turn pages do not wake it.
 */
export function useChromeVisible(hold) {
  const [visible, setVisible] = useState(true);
  const timer = useRef(null);
  const wake = useCallback(() => {
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), IDLE_MS);
  }, []);
  useEffect(() => {
    timer.current = setTimeout(() => setVisible(false), IDLE_MS); // shown at first, hidden once the reader settles
    const onMove = (event) => { if (event.pointerType === 'mouse' && (event.movementX || event.movementY)) wake(); };
    const onDown = (event) => { if (event.pointerType !== 'mouse') wake(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [wake]);
  return hold || visible;
}
