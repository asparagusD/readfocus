import { Link } from 'react-router-dom';
import { BookStack, Candle, CrescentMoon, OpenBook, TeaCup } from '../../illustrations';

const FEATURES = [
  {
    id: 'book', title: 'Feels like a book', Art: OpenBook,
    body: [
      'Your PDF or EPUB opens as it was published, with its pictures, figures, equations and code, two pages side by side on a wide screen, by day or by lamplight at night.',
      'Markdown files and Jupyter notebooks become books too, images kept. The reader opens where you stopped.',
    ],
  },
  {
    id: 'words', title: 'Understand every word', Art: CrescentMoon,
    body: [
      'Rest on a word, or press and hold it on a phone, and a small card explains it beside the line. You never leave the page.',
      'Words come from Wiktionary, names and places from Wikipedia. A rare word may have no entry, and the card says so.',
    ],
  },
  {
    id: 'adapts', title: 'Reading that adapts', Art: BookStack,
    body: [
      'After each session a few questions are written from sentences in the passages you read: a missing word, the right statement, the main idea. Each is tied to a concept, so ReadFocus learns which ideas you hold and which slip, and the next session brings those back.',
      'The quizzes, grading, planning and scoring are algorithmic and run on our servers: five rule-based agents and one small sentence-embedding model. A generative model never writes a question or marks an answer.',
    ],
  },
  {
    id: 'beside', title: 'Notes and Steve beside the book', Art: TeaCup,
    body: [
      'Highlight or underline a line, and keep notes, equations, code and drawings in a notepad beside the page. Each note stays tied to its place, so the book and your notes find each other.',
      'Steve, the optional study assistant, explains a passage, an equation or a figure and cites the page. He uses Google’s Gemini: when you ask him something, the relevant passages and your question are sent to Google and, on the free tier, may be used to improve Google’s products. He asks first, and you can turn him off.',
    ],
  },
  {
    id: 'focus', title: 'Focus, points and a weekly league', Art: Candle,
    body: [
      'From chapter 1, focus mode keeps a stopwatch on our server. Place a bookmark when you stop, answer a short quiz on what you read, and your focused minutes become points.',
      'Points become XP: a daily goal, a streak with freezes you earn, badges, and a weekly league of about thirty readers. Nothing to buy, no guilt, and you can keep off the boards.',
    ],
  },
];

/** Five editorial sections, text and drawing alternating sides (C13.10d; Steve, notes, focus and leagues in C25.1). */
export function Features() {
  return (
    <div className="rf-features">
      {FEATURES.map(({ id, title, Art, body }) => (
        <section key={id} className="rf-feature" aria-labelledby={`feature-${id}`}>
          <div className="rf-feature__text">
            <h2 id={`feature-${id}`} className="rf-feature__title">{title}</h2>
            {body.map((p) => <p key={p} className="rf-feature__body">{p}</p>)}
          </div>
          <Art className="rf-feature__art" />
        </section>
      ))}
      <aside className="rf-isnt" aria-labelledby="isnt-title">
        <h2 id="isnt-title" className="rf-isnt__title">What ReadFocus isn’t</h2>
        <ul className="rf-isnt__list">
          <li>Not an AI that reads for you. Questions come from your book’s own sentences, and only Steve, when you ask him, uses a generative model.</li>
          <li>No ads, and no selling your data. <Link to="/privacy">What we keep and what we send</Link>.</li>
          <li>Not a shared library: your books are private to your account.</li>
        </ul>
      </aside>
    </div>
  );
}
