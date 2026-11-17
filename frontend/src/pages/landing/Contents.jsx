import { m, useReducedMotion } from 'motion/react';
import { fadeIn, rise, stagger } from '../../motion/presets';

const STEPS = [
  { title: 'Upload a book', note: 'your shelf', body: 'Add a PDF, EPUB, Markdown file or notebook you own. ReadFocus splits it into short passages and keeps it on your account only.' },
  { title: 'Read where you left off', note: 'the book as published', body: 'Each book opens at your last page, with its images, figures, math and code. Read as far as you like, or turn on focus mode to earn points.' },
  { title: 'Answer a few questions', note: 'when you like', body: 'Quiz me asks a few questions written from sentences in the pages you read; focus mode asks them when you set your bookmark.' },
  { title: 'See what slips', note: 'your concepts', body: 'Each question is tied to an idea in the book, so your dashboard shows which ones you hold and which need another look.' },
];

const NUMERALS = ['I', 'II', 'III', 'IV'];

/**
 * How it works, set like a book's contents page (C13.10b): numerals in the margin, dotted
 * leaders. The steps rise in one after another the first time they scroll into view.
 */
export function Contents() {
  // Under reduced motion the steps only fade: no 12 px offset, even before they arrive.
  const item = useReducedMotion() ? fadeIn : rise;
  return (
    <section id="how-it-works" className="rf-toc" aria-labelledby="how-title" tabIndex={-1}>
      <h2 id="how-title" className="rf-toc__title">How it works</h2>
      <m.ol
        className="rf-toc__list"
        variants={stagger()}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        {STEPS.map((step, i) => (
          <m.li key={step.title} className="rf-toc__item" variants={item}>
            <span className="rf-toc__num" aria-hidden="true">{NUMERALS[i]}</span>
            <p className="rf-toc__line">
              <span className="rf-toc__name">{step.title}</span>
              <span className="rf-toc__leader" aria-hidden="true" />
              <span className="rf-toc__note">{step.note}</span>
            </p>
            <p className="rf-toc__body">{step.body}</p>
          </m.li>
        ))}
      </m.ol>
    </section>
  );
}
