import { BookStack, CrescentMoon, OpenBook } from '../../illustrations';

const FEATURES = [
  {
    id: 'book', title: 'Feels like a book', Art: OpenBook,
    body: [
      'Pages sit side by side and turn like paper, set in Lora on a warm page by day or by lamplight at night.',
      'A ribbon marks your place, and the reader opens where you stopped.',
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
      'There is no chatbot and nothing writes text: five rule-based agents and one small sentence-embedding model on our own server do the work.',
    ],
  },
];

/** Three editorial sections, text and drawing alternating sides (C13.10d). */
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
          <li>No generative AI. Questions come from your book’s own sentences.</li>
          <li>No ads, and no selling your data.</li>
          <li>Not a shared library: your books are private to your account.</li>
        </ul>
      </aside>
    </div>
  );
}
