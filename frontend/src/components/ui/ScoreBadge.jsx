import './ScoreBadge.css';

/**
 * Score pill from the handoff ("86% Session 5"): a Playfair figure and a
 * DM Sans label. `filled` (accent wash) for an earlier session, `outlined`
 * for the current one. The number carries the meaning, not a colour.
 */
export function ScoreBadge({ percentage, label, variant = 'filled', className = '' }) {
  const value = Math.round(percentage);
  return (
    <span className={`rf-score rf-score--${variant} ${className}`}>
      <span className="rf-score__figure figure">
        {value}<span className="rf-score__unit">%</span>
      </span>
      {label && <span className="rf-score__label">{label}</span>}
    </span>
  );
}
