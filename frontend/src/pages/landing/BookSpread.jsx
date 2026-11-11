import { m, useReducedMotion } from 'motion/react';
import { pageTurn, turnShade } from '../../motion/presets';
import { SOURCE, SPREAD } from './passages';

/** The page turn waits for the page to settle, then plays once (C13.10b). */
const DELAY_S = 0.6;
const leafTurn = {
  flat: pageTurn.flat,
  turned: (dir) => {
    const target = pageTurn.turned(dir);
    return { rotateY: target.rotateY, transition: { ...target.transition, delay: DELAY_S } };
  },
};
const shade = {
  flat: turnShade.flat,
  turned: { opacity: turnShade.turned.opacity, get transition() { return { ...turnShade.turned.transition, delay: DELAY_S }; } },
};

/**
 * An open book set in the reader's own typography (C13.10b): running heads,
 * Lora justified text, old-style folios. A blank flyleaf over the right-hand
 * page turns once after load; under reduced motion there is no leaf at all.
 */
export function BookSpread() {
  const reduced = useReducedMotion();
  return (
    <figure className="rf-spread">
      <div className="rf-spread__book">
        <div className="rf-spread__page" data-side="left">
          <p className="rf-spread__head" aria-hidden="true">{SOURCE.title}</p>
          <p className="rf-spread__chapter">{SPREAD.chapter}</p>
          <p className="rf-spread__text">{SPREAD.left}</p>
          <p className="rf-spread__folio" aria-hidden="true">52</p>
        </div>
        <div className="rf-spread__page" data-side="right">
          <p className="rf-spread__head" aria-hidden="true">{SPREAD.chapter}</p>
          <p className="rf-spread__text">{SPREAD.right}</p>
          <p className="rf-spread__folio" aria-hidden="true">53</p>
          {!reduced && (
            <m.div
              className="rf-spread__leaf"
              aria-hidden="true"
              custom={{ to: -180 }}
              variants={leafTurn}
              initial="flat"
              animate="turned"
            >
              <m.span className="rf-spread__leaf-shade" variants={shade} />
            </m.div>
          )}
        </div>
      </div>
      <figcaption className="rf-spread__caption">
        {SOURCE.author}, <cite>{SOURCE.title}</cite>, Book IV, III, translated by {SOURCE.translator} ({SOURCE.year}).
        Public domain, from <a href={SOURCE.url}>Project Gutenberg</a>.
      </figcaption>
    </figure>
  );
}
