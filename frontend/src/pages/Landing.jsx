import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { API_BASE_URL } from '../lib/api';
import { wakeBackend } from './landing/wake';
import { BookSpread } from './landing/BookSpread';
import { Contents } from './landing/Contents';
import { WordDemo } from './landing/WordDemo';
import { Features } from './landing/Features';
import { Faq } from './landing/Faq';
import { LandingFooter } from './landing/LandingFooter';
import { DuskWindow, ReadingLamp } from '../illustrations';
import './Landing.css';

/**
 * The public landing page for signed-out visitors at "/" (C13.10).
 * Static: it renders without waiting on the backend, and only starts
 * waking it with one fire-and-forget GET /health.
 */
const TITLE = 'ReadFocus — read deeply, remember more';

/** "See how it works" scrolls to the contents (smoothly unless reduced motion, in CSS) and moves focus there. */
function toContents(event) {
  const target = document.getElementById('how-it-works');
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
  window.history.replaceState(null, '', '#how-it-works');
}

export function Landing() {
  useEffect(() => {
    document.title = TITLE; // as in index.html, for a visitor who comes back from another page
    wakeBackend(API_BASE_URL);
  }, []);

  return (
    <div className="rf-landing">
      <a className="rf-landing__skip" href="#landing-main">Skip to content</a>
      <header className="rf-landing__masthead">
        <Link to="/" className="rf-landing__mark" aria-label="ReadFocus, home">
          <BookOpen size={24} strokeWidth={1.75} aria-hidden="true" />
          <span aria-hidden="true">ReadFocus</span>
        </Link>
        <Link to="/login" className="rf-landing__signin">Sign in</Link>
      </header>
      <main id="landing-main" tabIndex={-1}>
        <section className="rf-landing__hero" aria-labelledby="landing-title">
          <div className="rf-landing__intro">
            <h1 id="landing-title" className="rf-landing__title">A quiet place to read deeply.</h1>
            <p className="rf-landing__lead">
              ReadFocus turns any book into focused reading sessions that feel like a real book,
              explains unfamiliar words right where you read them, checks what you understood,
              and plans your next session around what you missed.
            </p>
            <div className="rf-landing__actions">
              <Link to="/login?tab=signup" className="rf-btn rf-btn--primary">Start reading</Link>
              <a href="#how-it-works" className="rf-btn rf-btn--ghost" onClick={toContents}>See how it works</a>
            </div>
          </div>
          <div className="rf-landing__scene">
            <DuskWindow className="rf-landing__window" />
            <ReadingLamp className="rf-landing__lamp" />
            <BookSpread />
          </div>
        </section>
        <Contents />
        <WordDemo />
        <Features />
        <Faq />
      </main>
      <LandingFooter />
    </div>
  );
}
