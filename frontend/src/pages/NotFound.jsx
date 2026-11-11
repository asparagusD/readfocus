import { Link, useLocation } from 'react-router-dom';
import { ErrorScreen } from '../components/ErrorScreen';

/** An address no route knows (C13.8a), inside Layout so the nav stays. */
export function NotFound() {
  const { pathname } = useLocation();
  return (
    <ErrorScreen
      eyebrow="Page not found"
      title="This page isn’t on the shelf."
      body="The address may be old or mistyped. Your books are where you left them."
      code={`404 · ${pathname}`}
    >
      <Link to="/" className="rf-btn rf-btn--primary">Back to your shelf</Link>
    </ErrorScreen>
  );
}
