import { Link } from 'react-router-dom';
import { ThemeToggle } from '../../components/ThemeToggle';

export const REPO_URL = 'https://github.com/asparagusD/readfocus';

/** Closing invitation, then the colophon: source code, credits and the theme (C13.10d). */
export function LandingFooter() {
  return (
    <footer className="rf-colophon">
      <div className="rf-colophon__close">
        <p className="rf-colophon__line">Bring a book you have been meaning to read.</p>
        <Link to="/login?tab=signup" className="rf-btn rf-btn--primary">Start reading</Link>
      </div>
      <div className="rf-colophon__meta">
        <p className="rf-colophon__credits">
          Definitions: <a href="https://en.wiktionary.org/">Wiktionary</a> via
          the <a href="https://dictionaryapi.dev/">Free Dictionary API</a> (CC BY-SA 3.0) and
          {' '}<a href="https://en.wikipedia.org/">Wikipedia</a> (CC BY-SA 4.0). Sample text: Marcus
          Aurelius, <cite>Meditations</cite>, public domain, from <a href="https://www.gutenberg.org/ebooks/2680">Project Gutenberg</a>.
          {' '}<a href={REPO_URL}>Source code on GitHub</a>.
        </p>
        <ThemeToggle />
      </div>
    </footer>
  );
}
