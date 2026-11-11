import './MasteryBar.css';

/**
 * Mastery bar from the components sheet: an accent bar on a track, 0-100.
 * The shelf uses it for reading progress, the dashboard for concept
 * mastery. The figure is printed beside it by the caller, so the bar is
 * decorative unless `label` names it ("Walden: 62% read").
 */
export function MasteryBar({ value = 0, label, className = '' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span
      className={`rf-mastery ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <span className="rf-mastery__fill" style={{ transform: `scaleX(${pct / 100})` }} />
    </span>
  );
}
