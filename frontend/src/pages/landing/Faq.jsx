const QUESTIONS = [
  ['Which files work?', 'PDF and EPUB. A PDF needs selectable text: a scan that is only pictures of pages has nothing to read.'],
  ['Is it free?', 'Yes. There is no paid tier and no ads.'],
  ['Where do definitions come from?', 'English words come from Wiktionary through the Free Dictionary API; names, places and phrases from Wikipedia’s summaries. Each card says which.'],
  ['Why is the first load slow sometimes?', 'ReadFocus runs on free hosting that sleeps after a while without visitors. The first visit after that wakes it, which can take up to a minute; a warm-up screen shows while it does.'],
  ['Can I delete my books?', 'Yes. Remove a book from your shelf and its file and its record are deleted.'],
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
