import { useLayoutEffect, useState } from 'react';

/** The element's size, rounded, kept current by a ResizeObserver. */
export function useBoxSize(ref) {
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const next = { width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) };
      setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
