import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { BookOpen } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { Button } from '../components/ui/Button';
import { DuskWindow, ReadingLamp, BookStack, TeaCup } from '../illustrations';
import { fadeIn, rise } from '../motion/presets';
import './Login.css';

/** The form rises into place without fading, so its text paints at once (first contentful paint). */
const formRise = {
  hidden: { y: rise.hidden.y },
  visible: { y: 0, get transition() { return rise.visible.transition; } },
};

// C28.1: one button for both; a new Google account gets a shelf on its first sign-in.
const COPY = {
  signin: { title: 'Welcome back', lead: 'Sign in with your Google account to return to your shelf.' },
  signup: { title: 'Make yourself a shelf', lead: 'Use your Google account to start your first book. No password, no email to confirm.' },
};

/** Google's "G", in its own colours, as Google's sign-in guidelines ask. */
function GoogleMark() {
  return (
    <svg className="rf-login__google" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** A Supabase or Google error in the room's voice. */
function fromServer(error) {
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return 'We couldn’t reach the sign-in service. Check your connection and try again.';
  }
  return error.message;
}

export function Login() {
  const { user, signInWithGoogle } = useAuth();
  const [params] = useSearchParams();
  // The landing page's "Start reading" opens with the new-reader words (C13.10a).
  const copy = COPY[params.get('tab') === 'signup' ? 'signup' : 'signin'];
  // Google or Supabase sends a refusal back as ?error_description= on this page.
  const [error, setError] = useState(() => params.get('error_description') ?? '');
  const [loading, setLoading] = useState(false);
  const reduced = useReducedMotion();

  useDocumentTitle('Sign in');

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    const { error: failed } = await signInWithGoogle();
    // On success the browser is already leaving for Google; the button stays busy until it does.
    if (failed) {
      setLoading(false);
      setError(fromServer(failed));
    }
  };

  // Back from Google with a session: straight to the shelf.
  if (user) return <Navigate to="/" replace />;

  // The routes' AnimatePresence starts with initial={false}, which would skip these
  // entrances on a first load; a nested AnimatePresence gives them their own start.
  // Only the drawings fade; text is never hidden, so the first paint is not held back
  // until Motion loads. Under reduced motion the form does not move at all.
  return (
    <div className="rf-login">
      <AnimatePresence>
      <aside key="scene" className="rf-login__scene">
        <p className="rf-login__mark">
          <BookOpen size={24} strokeWidth={1.75} aria-hidden="true" />
          <span>ReadFocus</span>
        </p>
        <m.div className="rf-login__art" variants={fadeIn} initial="hidden" animate="visible">
          <BookStack className="rf-login__books" />
          <DuskWindow className="rf-login__window" />
          <TeaCup className="rf-login__tea" />
          <ReadingLamp className="rf-login__lamp" />
        </m.div>
        <div className="rf-login__words">
          <p className="rf-login__tagline">Read slowly.<br />Keep what you read.</p>
          <p className="rf-login__sub">Read the book as published, quiz yourself when you like, and see which ideas slip.</p>
        </div>
      </aside>

      <main key="panel" className="rf-login__panel">
        <m.div className="rf-login__card" variants={formRise} initial={reduced ? false : 'hidden'} animate="visible">
          <h1 className="rf-login__title">{copy.title}</h1>
          <p className="rf-login__lead">{copy.lead}</p>
          <Button variant="secondary" loading={loading} loadingLabel="Opening Google…" className="rf-login__submit" onClick={handleGoogle}>
            {!loading && <GoogleMark />}
            Continue with Google
          </Button>
          <p className="rf-login__error" role="alert">{error}</p>
          <p className="rf-login__note">First visit of the evening? The room may take a moment to warm up.</p>
        </m.div>
      </main>
      </AnimatePresence>
    </div>
  );
}
