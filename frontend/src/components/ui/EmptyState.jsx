import './EmptyState.css';

/**
 * Empty state from the handoff ("Your shelf is waiting"): a raised card
 * with an illustration, a Playfair title, one line of copy and one
 * action. Stacks on narrow screens. `headingLevel` keeps the outline right.
 */
export function EmptyState({ illustration, title, children, action, headingLevel = 2, className = '' }) {
  const Heading = `h${headingLevel}`;
  return (
    <section className={`rf-empty ${className}`}>
      {illustration && <div className="rf-empty__art" aria-hidden="true">{illustration}</div>}
      <div className="rf-empty__text">
        <Heading className="rf-empty__title">{title}</Heading>
        {children && <p className="rf-empty__body">{children}</p>}
        {action && <div className="rf-empty__action">{action}</div>}
      </div>
    </section>
  );
}
