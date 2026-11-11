import './Card.css';

/**
 * Surface from the handoff: `raised` (--surface, 1 px hairline, radius 14)
 * or `sunken` (--paper-2, no line). Surfaces separate with hairlines, not
 * shadows. `interactive` (or the old `hoverable`) darkens the hairline on
 * hover; pass `as="a"`, `as="section"`, etc. for the right element.
 */
export function Card({
  as: Tag = 'div',
  variant = 'raised',
  interactive = false,
  hoverable = false,
  className = '',
  children,
  ...props
}) {
  const hover = interactive || hoverable ? 'rf-card--interactive' : '';
  return (
    <Tag className={`rf-card rf-card--${variant} ${hover} ${className}`} {...props}>
      {children}
    </Tag>
  );
}
