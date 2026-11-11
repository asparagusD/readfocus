import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { BookOpen } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/TextInput';
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import { tabId, panelId } from '../components/ui/tabIds';
import { DuskWindow, ReadingLamp, BookStack, TeaCup } from '../illustrations';
import { fadeIn, rise } from '../motion/presets';
import './Login.css';

/** The form rises into place without fading, so its text paints at once (first contentful paint). */
const formRise = {
  hidden: { y: rise.hidden.y },
  visible: { y: 0, get transition() { return rise.visible.transition; } },
};

const TABS = [{ value: 'signin', label: 'Sign in' }, { value: 'signup', label: 'Create account' }];
const COPY = {
  signin: { title: 'Welcome back', lead: 'Sign in to return to your shelf.', submit: 'Sign in', busy: 'Signing in…' },
  signup: { title: 'Make yourself a shelf', lead: 'Create an account to start your first book.', submit: 'Create account', busy: 'Creating account…' },
};

/** Field errors before anything is sent; the server still has the last word. */
function validate(tab, { name, email, password }) {
  const errors = {};
  if (tab === 'signup' && !name.trim()) errors.name = 'Enter a name for your shelf.';
  if (!email.trim()) errors.email = 'Enter your email address.';
  else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'That doesn’t look like an email address.';
  if (!password) errors.password = 'Enter your password.';
  else if (tab === 'signup' && password.length < 6) errors.password = 'Use at least 6 characters.';
  return errors;
}

/** A Supabase auth error in the room's voice, on the field it concerns when there is one. */
function fromServer(error) {
  if (/invalid login credentials/i.test(error.message)) return { password: 'That password doesn’t match this email.' };
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return { form: 'We couldn’t reach the sign-in service. Check your connection and try again.' };
  }
  return { form: error.message };
}

export function Login() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('signin');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  const formRef = useRef(null);
  const copy = COPY[tab];
  const reduced = useReducedMotion();

  useDocumentTitle('Sign in');

  const field = (key) => ({
    value: values[key],
    error: errors[key],
    onChange: (e) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  const focusFirstError = (found) => {
    const first = ['name', 'email', 'password'].find((key) => found[key]);
    if (first) formRef.current?.querySelector(`[name="${first}"]`)?.focus();
  };

  const switchTab = (next) => {
    setTab(next);
    setErrors({});
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const found = validate(tab, values);
    setErrors(found);
    if (Object.keys(found).length) return focusFirstError(found);
    setLoading(true);
    const { error } = tab === 'signup'
      ? await signUp(values.email.trim(), values.password)
      : await signIn(values.email.trim(), values.password);
    setLoading(false);
    if (error) {
      const next = fromServer(error);
      setErrors(next);
      return focusFirstError(next);
    }
    if (tab === 'signup') setSignedUp(true);
    else navigate('/');
  };

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
          <p className="rf-login__sub">Focused sessions, a short test, and a reading plan that remembers where you struggled.</p>
        </div>
      </aside>

      <main key="panel" className="rf-login__panel">
        <m.div className="rf-login__card" variants={formRise} initial={reduced ? false : 'hidden'} animate="visible">
          {signedUp ? (
            <div className="rf-login__done" role="status">
              <h1 className="rf-login__title">Check your inbox</h1>
              <p className="rf-login__lead">We sent a confirmation link to {values.email.trim()}. Open it, then sign in here.</p>
              <Button variant="secondary" onClick={() => { setSignedUp(false); switchTab('signin'); }}>Back to sign in</Button>
            </div>
          ) : (
            <>
              <h1 className="rf-login__title">{copy.title}</h1>
              <p className="rf-login__lead">{copy.lead}</p>
              <SegmentedTabs idBase="auth" label="Sign in or create an account" options={TABS} value={tab} onChange={switchTab} />
              <div role="tabpanel" id={panelId('auth')} aria-labelledby={tabId('auth', tab)}>
              <form ref={formRef} className="rf-login__form" onSubmit={handleSubmit} noValidate>
                {tab === 'signup' && <TextInput label="Your name" name="name" autoComplete="name" {...field('name')} />}
                <TextInput label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" {...field('email')} />
                <TextInput
                  label="Password"
                  name="password"
                  type="password"
                  autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                  {...field('password')}
                />
                <p className="rf-login__error" role="alert">{errors.form}</p>
                <Button type="submit" loading={loading} loadingLabel={copy.busy} className="rf-login__submit">{copy.submit}</Button>
              </form>
              </div>
              <p className="rf-login__note">First visit of the evening? The room may take a moment to warm up.</p>
            </>
          )}
        </m.div>
      </main>
      </AnimatePresence>
    </div>
  );
}
