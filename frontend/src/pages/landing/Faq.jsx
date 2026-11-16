import { Link } from 'react-router-dom';

/** Answers checked against the code and docs/STEVE.md, FOCUS_RULES.md and GAMIFICATION.md (C25.1). */
const QUESTIONS = [
  ['Which files work?', 'PDF, EPUB, Markdown (a .md file, or a .zip with its images) and Jupyter notebooks (.ipynb). Markdown and notebooks become books with their images kept. A scanned PDF works too: its pages are read with text recognition in your browser, in English.'],
  ['Is it free?', 'Yes. There is no paid tier and no ads.'],
  ['Is Steve free?', 'Yes. Steve runs on the free tier of Google’s Gemini, with a daily number of questions for each reader. For more, you can add your own free Gemini key from Google AI Studio; it is encrypted on our server and never shown again.'],
  ['What’s sent to Google?', (
    <>
      Only what Steve needs, and only when you ask him something: your question and a limited part of the book (the
      pages of your session, the passage you selected, the table of contents and a few related passages, or the
      picture of an equation or figure you asked about). Never the whole book, never your name or email, and your
      notes only when you ask about them. On the free tier Google may use prompts and answers to improve its products.
      The quizzes, grading, planning and points never use Google. More on the <Link to="/privacy">privacy page</Link>.
    </>
  )],
  ['Why does Steve sometimes rest?', 'Each reader has a daily number of questions, which comes back at your midnight, and Google’s free tier has limits that everyone on our key shares; when Google says it is busy, Steve pauses for at least ten minutes. He also steps away during a test or a bookmark quiz. Reading never waits for him.'],
  ['How are points calculated?', 'In focus mode our server counts your focused minutes: 10 points each. Time with the tab hidden, after an unanswered “Still with the book?”, past 30 minutes on one page or past three hours does not count. When you place your bookmark, a short quiz on the pages you read adds 20 points for each right answer, never more than the minutes earned. Below 40% the session earns nothing; otherwise its points become XP.'],
  ['Where do definitions come from?', 'English words come from Wiktionary through the Free Dictionary API; names, places and phrases from Wikipedia’s summaries. Each card says which.'],
  ['Why is the first load slow sometimes?', 'ReadFocus runs on free hosting that sleeps after a while without visitors. The first visit after that wakes it, which can take up to a minute; a warm-up screen shows while it does.'],
  ['Can I delete my books?', (
    <>
      Yes. Remove a book from your shelf and its file and text are deleted, with your highlights, notes, Steve
      conversations and focus sessions for it. Pictures in your notes (crops and drawing previews) are not yet removed
      with it; the <Link to="/privacy">privacy page</Link> says what else is kept and how to ask for it to go.
    </>
  )],
];

/** Questions as native <details> (C13.10d): keyboard and screen reader support come built in. */
export function Faq() {
  return (
    <section className="rf-faq" aria-labelledby="faq-title">
      <h2 id="faq-title" className="rf-faq__title">Questions</h2>
      {QUESTIONS.map(([q, a]) => (
        <details key={q} className="rf-faq__item">
          <summary className="rf-faq__q">{q}</summary>
          <p className="rf-faq__a">{a}</p>
        </details>
      ))}
    </section>
  );
}
