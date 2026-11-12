import { TeaCup } from '../illustrations';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import './ErrorScreen.css';

/**
 * The error screen (handoff screen 10): the cooled tea cup, an eyebrow, a
 * heading, a short body, the actions passed as children, and a small
 * monospace line for whoever reports it (`code`). Used when the backend
 * does not answer, by the error boundary and for an unknown address.
 * `standalone` (outside Layout, which has its own <main>) makes it the main.
 */
export function ErrorScreen({ eyebrow = 'Something went quiet', title, body, code, standalone = false, children }) {
  useDocumentTitle(eyebrow);
  const Root = standalone ? 'main' : 'div';
  return (
    <Root className="rf-error">
      <TeaCup steam={false} className="rf-error__art" />
      <div className="rf-error__text">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="rf-error__title">{title}</h1>
        <p className="rf-error__body">{body}</p>
        <div className="rf-error__actions">{children}</div>
        {code && <p className="rf-error__code">{code}</p>}
      </div>
    </Root>
  );
}
