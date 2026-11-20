import { useEffect, useState } from 'react';

/** Whether a media query matches, kept current (C38.4b's, shared since C38.6a). */
export function useMedia(query) {
  const [on, setOn] = useState(() => globalThis.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const list = globalThis.matchMedia?.(query);
    const change = () => setOn(list.matches);
    change();
    list?.addEventListener('change', change);
    return () => list?.removeEventListener('change', change);
  }, [query]);
  return on;
}
