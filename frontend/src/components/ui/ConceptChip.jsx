import { Check, RotateCcw } from 'lucide-react';
import { m, useReducedMotion } from 'motion/react';
import { chipPop, fadeIn, stagger } from '../../motion/presets';
import './ConceptChip.css';

const KINDS = {
  strengthened: { prefix: 'Strengthened', Icon: Check },
  revisit: { prefix: 'To revisit', Icon: RotateCcw },
};

/**
 * Concept chip from the results screen. The two kinds differ by fill,
 * border style, icon and words, never by hue alone: `strengthened` is an
 * accent wash with a check, `revisit` a dashed outline with a turn-back
 * arrow. Use inside ConceptChipGroup so they pop in 60 ms apart.
 */
export function ConceptChip({ kind = 'strengthened', children }) {
  const reduced = useReducedMotion();
  const { prefix, Icon } = KINDS[kind];
  return (
    <m.li className={`rf-chip rf-chip--${kind}`} variants={reduced ? fadeIn : chipPop}>
      <Icon className="rf-chip__icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{prefix} · {children}</span>
    </m.li>
  );
}

/** A list of chips that reveals them one after another. `label` names the list. */
export function ConceptChipGroup({ label, children, className = '' }) {
  return (
    <m.ul
      className={`rf-chip-group ${className}`}
      aria-label={label}
      variants={stagger()}
      initial="hidden"
      animate="visible"
    >
      {children}
    </m.ul>
  );
}
