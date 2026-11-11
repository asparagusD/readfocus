import { m } from 'motion/react';
import { drawIn } from '../../motion/presets';
import './ProgressRing.css';

/**
 * Concept-mastery ring from the handoff: an accent arc on a hairline
 * track with the percentage in the middle. The arc draws in over --dur-6
 * (instant under reduced motion). Read by assistive tech as one image,
 * "<label>: <value>%".
 */
export function ProgressRing({ value, label = 'Progress', size = 64, stroke = 5, className = '' }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  const r = (size - stroke) / 2;
  return (
    <span
      className={`rf-ring ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${clamped}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="rf-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        {clamped > 0 && (
          <m.circle
            className="rf-ring__arc"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: clamped / 100 }}
            transition={drawIn.visible.transition}
          />
        )}
      </svg>
      <span className="rf-ring__value" aria-hidden="true">{clamped}%</span>
    </span>
  );
}
