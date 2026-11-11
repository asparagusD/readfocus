import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { seconds } from './presets';

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * Counts from 0 up to `target` (moment 5, the score reveal) with an
 * ease-out cubic over --dur-6. Under reduced motion, or for a value that
 * is not a finite number, it returns `target` as it is. Rounds to
 * `decimals` places.
 */
export function useCountUp(target, { duration, decimals = 0 } = {}) {
  const reduced = useReducedMotion();
  const animate = !reduced && Number.isFinite(target);
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!animate) return undefined;
    const total = (duration ?? seconds('--dur-6')) * 1000;
    const factor = 10 ** decimals;
    let frame;
    let start;
    const step = (now) => {
      start ??= now;
      const t = Math.min((now - start) / total, 1);
      setValue(Math.round(target * easeOutCubic(t) * factor) / factor);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [animate, target, duration, decimals]);

  return animate ? value : target;
}
