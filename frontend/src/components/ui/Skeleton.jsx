import './Skeleton.css';

/**
 * Placeholder block on --paper-2, radius 6, with a 1.6 s shimmer (stops
 * under reduced motion). Hidden from assistive tech: mark the region that
 * is loading with aria-busy instead. `lines` renders a paragraph of text
 * lines, the last one shorter. Width and height are set only when given,
 * so a className can size it.
 */
export function Skeleton({ width, height, lines, className = '', style, ...props }) {
  if (lines) {
    return (
      <div className={`rf-skeleton-lines ${className}`} aria-hidden="true" {...props}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="rf-skeleton" style={{ width: i === lines - 1 && lines > 1 ? '60%' : '100%' }} />
        ))}
      </div>
    );
  }
  return <div className={`rf-skeleton ${className}`} style={{ width, height, ...style }} aria-hidden="true" {...props} />;
}
