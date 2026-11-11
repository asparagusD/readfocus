import { m, useReducedMotion } from 'motion/react';
import { fadeIn, rise, stagger } from '../../motion/presets';

const STEPS = [
  { title: 'Upload a PDF or EPUB', note: 'your shelf', body: 'Add a book you own. ReadFocus splits it into short passages and keeps it on your account only.' },
  { title: 'Read in focused sessions', note: 'a few passages', body: 'Each session sets a handful of passages as pages you turn, with a quiet clock you can pause.' },
  { title: 'Answer a few questions', note: 'a short test', body: 'A short test follows each session, written from sentences in the passages you just read.' },
  { title: 'Your next session adapts', note: 'your plan', body: 'Missed something? It comes back for a re-read or a review, and the next session grows or shrinks with your scores.' },
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
