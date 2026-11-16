import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { LandingFooter } from './landing/LandingFooter';
import './Privacy.css';

/**
 * The public privacy page (C25.1): what ReadFocus keeps, what goes to Google and when, who sees what, and how to
 * delete it. Static and outside the backend gate, like the landing page. Every sentence was checked against the
 * code and docs/STEVE.md, ARCHITECTURE.md (data model) and GAMIFICATION.md; change them together.
 */

/** Where account deletion requests go. Empty until the owner names an address (C25.1 open item, before release). */
export const PRIVACY_CONTACT = '';
export const PRIVACY_UPDATED = '16 November 2026';
const TITLE = 'Privacy — ReadFocus';

function Contact() {
  if (PRIVACY_CONTACT) {
    return <>to delete your whole account, write to <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a> from the email you sign in with. We delete it by hand, with everything listed above.</>;
  }
  return <>deleting your whole account is done by hand, on request, with everything listed above. The address to write to will be given here.</>;
}

export function Privacy() {
  useEffect(() => { document.title = TITLE; }, []);
  return (
    <div className="rf-landing rf-privacy">
      <a className="rf-landing__skip" href="#privacy-main">Skip to content</a>
      <header className="rf-landing__masthead">
        <Link to="/" className="rf-landing__mark" aria-label="ReadFocus, home">
          <BookOpen size={24} strokeWidth={1.75} aria-hidden="true" />
          <span aria-hidden="true">ReadFocus</span>
        </Link>
        <Link to="/login" className="rf-landing__signin">Sign in</Link>
      </header>
      <main id="privacy-main" tabIndex={-1} className="rf-privacy__page">
        <p className="rf-privacy__eyebrow">Updated {PRIVACY_UPDATED}</p>
        <h1 className="rf-privacy__title">Privacy</h1>
        <p className="rf-privacy__lead">
          ReadFocus’s quizzes, grading, planning and scoring are algorithmic and run on our servers. Steve, the optional
          study assistant, uses Google’s Gemini; when you ask Steve something, the relevant passages and your question
          are sent to Google and, on the free tier, may be used to improve Google’s products. You can turn Steve off.
        </p>

        <section aria-labelledby="privacy-stored">
          <h2 id="privacy-stored">What we keep</h2>
          <ul>
            <li><strong>Your account:</strong> the email you sign in with, the name your sign-in gives us if it gives one,
              and the display name you choose for leagues.</li>
            <li><strong>Your books:</strong> the file you upload (unless you choose to keep it on your device), its text cut
              into passages, the questions built from them and a map of each page’s prose, equations, code and figures.
              For a scanned PDF, the words your browser read from its pages.</li>
            <li><strong>Your reading:</strong> your place in each book, your sessions, your answers and scores, how well
              you hold each idea, and the reasons for each plan.</li>
            <li><strong>Your highlights and notes,</strong> including drawings and the pictures you add to notes.</li>
            <li><strong>Steve:</strong> whether he is on, when you agreed to his notice, your conversations with him for
              each book, and how many questions you asked today. If you add your own Gemini key it is encrypted, never
              shown again, and only its last four characters are kept in the clear.</li>
            <li><strong>Focus and progress:</strong> your focus sessions and their timings, points, XP, streak, badges,
              daily goal, time zone and league places.</li>
          </ul>
          <p>
            It is kept in our database and file storage at Supabase, on servers in Mumbai, and handled by our backend on
            Render. There are no ads, no analytics or tracking scripts, and we do not sell or share your data.
          </p>
        </section>

        <section aria-labelledby="privacy-google">
          <h2 id="privacy-google">What goes to Google, and when</h2>
          <p>
            Nothing, until you turn Steve on and agree to his notice. After that, only when you ask him something, our
            server sends Google your question and a limited part of the book: the pages of your current session, the
            passage you selected, the table of contents and a few related passages, or the picture of an equation, code
            or figure you asked about. Never the whole book, never your name or email, and your notes only when you ask
            about them. “Copy as LaTeX” on a drawn PDF equation sends a picture of that equation, under the same
            consent and switch.
          </p>
          <p>
            ReadFocus uses Gemini’s free tier. <a href="https://aistudio.google.com/docs/terms">Google’s terms for
            it</a> say Google may use what is sent and what Gemini answers to provide, improve and develop its products,
            and that people may review them, so please do not ask Steve about anything sensitive or personal. If you add your own Gemini key, your own agreement with Google for
            that key applies instead. Your browser never talks to Google; our server does.
          </p>
          <p>
            To stop, open Steve’s settings in the reader and switch off “Send book text to Gemini”. While he is off,
            nothing is sent.
          </p>
        </section>

        <section aria-labelledby="privacy-others">
          <h2 id="privacy-others">Other services</h2>
          <p>
            When you look up a word, our server asks the Free Dictionary API or Wikipedia about that word or phrase, and
            keeps the answer for everyone; nothing about you goes with it. When a book is added, its title and author are
            searched on Open Library once for a cover. Text recognition for scanned pages runs in your own browser.
          </p>
        </section>

        <section aria-labelledby="privacy-seen">
          <h2 id="privacy-seen">Who sees what</h2>
          <p>
            Your books, notes, highlights, Steve conversations and progress are yours alone. Weekly leagues show other
            readers in your group only your display name (or “Reader” and four letters if you set none) and your XP for
            the week, never your email or your books. You can keep off the boards in your league settings.
          </p>
        </section>

        <section aria-labelledby="privacy-delete">
          <h2 id="privacy-delete">Deleting</h2>
          <ul>
            <li><strong>A book:</strong> remove it from your shelf, and its file, its text and questions, your sessions,
              highlights, notes, Steve conversations and focus sessions for it are deleted. Pictures in your notes (crops
              and drawing previews) are not yet removed with the book; ask for them to go as below.</li>
            <li><strong>A highlight</strong> is deleted at once. <strong>A note</strong> disappears at once and is erased
              for good when you remove its book.</li>
            <li><strong>Your Gemini key:</strong> remove it in Steve’s settings, and it is erased.</li>
            <li><strong>Your XP, streak, badges and league places</strong> belong to your account, not to a book, so they
              stay when a book goes.</li>
            <li><strong>Your account:</strong> <Contact /></li>
          </ul>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
