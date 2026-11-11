import { Link, useLocation } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { useBackendReady } from '../lib/useBackendReady';
import { errorLine } from '../lib/backendReady';
import { Button } from './ui/Button';
import { ErrorScreen } from './ErrorScreen';
import { WarmingUp } from './WarmingUp';

/** Routes that do not need the backend: sign in (Supabase only) and the dev galleries. */
const open = (path) => path === '/login' || path.startsWith('/__');

/**
 * Holds the app back until GET /health says the backend is ready (C13.8a).
 * A warm start shows nothing extra; after 1.5 s the warm-up screen shows;
 * a backend that never answers in 90 s gets the error screen with Try again.
 * The poll starts on every route, so it is already waking during sign in.
 */
export function BackendGate({ children }) {
  const { pathname } = useLocation();
  const { phase, state, retry } = useBackendReady();
  if (open(pathname) || phase === 'ready') return children;
  if (phase === 'checking') return null;
  if (phase === 'warming') return <WarmingUp />;
  return (
    <ErrorScreen
      standalone
      title="The reading room didn’t answer."
      body="We couldn’t reach ReadFocus just now. Nothing is lost: your books, your place and your tests are saved."
      code={errorLine(state)}
    >
      <Button onClick={retry}>
        <RotateCcw size={18} strokeWidth={1.75} aria-hidden="true" />
        Try again
      </Button>
      <Link to="/login" className="rf-btn rf-btn--ghost">Back to sign in</Link>
    </ErrorScreen>
  );
}
