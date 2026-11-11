import { useEffect, useRef } from 'react';
import { m } from 'motion/react';
import { pageTurn, seconds, turnShade } from '../motion/presets';
import { BookFlow } from './BookFlow';

const px = (n) => `${n}px`;

/** A page as paper: its furniture and, when it exists, a window onto a copy of the flow at that page. */
function Face({ page, side, g, blocks, lang, count, furniture, className = '', shade }) {
  return (
    <div className={`rf-leaf rf-face ${className}`} data-side={side}>
      {page < count && (
        <>
          {furniture(page, side)}
          <div className="rf-window">
            <div className="rf-flow" lang={lang} style={{ transform: `translateX(${-page * g.stride}px)` }}>
              <BookFlow blocks={blocks} />
            </div>
          </div>
        </>
      )}
      {shade && <m.div className="rf-turn-shade" data-side={side} variants={turnShade} />}
    </div>
  );
}

/**
 * One page turn over the book (C12.4): a leaf hinged at the spine, with a
 * cover keeping the page underneath as it was until the leaf lands. The
 * main flow has already moved to the new page. Spread forward: the right
 * leaf (old right / new left) turns left; back: the left leaf (old left /
 * new right) turns right. One page forward: the page lifts away; back: the
 * earlier page swings in over the current one. Only transform and opacity
 * move. A timer ends the turn too, in case Motion's features have not
 * loaded yet. aria-hidden: the live region speaks for it.
 */
export function PageTurn({ turn, g, blocks, lang, count, furniture, onDone }) {
  const done = useRef(false);
  useEffect(() => {
    done.current = false;
    const timer = setTimeout(() => { if (!done.current) { done.current = true; onDone(); } }, seconds('--dur-5') * 1000 + 250);
    return () => clearTimeout(timer);
  }, [turn.id, onDone]);
  const finish = () => { if (!done.current) { done.current = true; onDone(); } };

  const { from, to, dir } = turn;
  const face = { g, blocks, lang, count, furniture };
  let cover = null;
  let leaf;
  if (g.spread && dir > 0) {
    cover = { page: from, side: 'left', slot: 0 };
    leaf = { slot: 1, origin: 'left', motion: { to: -180 }, front: [from + 1, 'right'], back: [to, 'left'] };
  } else if (g.spread) {
    cover = { page: from + 1, side: 'right', slot: 1 };
    leaf = { slot: 0, origin: 'right', motion: { to: 180 }, front: [from, 'left'], back: [to + 1, 'right'] };
  } else if (dir > 0) {
    leaf = { slot: 0, origin: 'left', motion: { to: -180 }, front: [from, 'single'] };
  } else {
    cover = { page: from, side: 'single', slot: 0 };
    leaf = { slot: 0, origin: 'left', motion: { from: -180, to: 0 }, front: [to, 'single'] };
  }

  return (
    <div className="rf-turning" aria-hidden="true">
      {cover && (
        <m.div className="rf-turn-slot" style={{ left: px(cover.slot * g.pageWidth) }} initial="flat" animate="turned">
          <Face {...face} page={cover.page} side={cover.side} shade />
        </m.div>
      )}
      <m.div
        className="rf-turn-leaf"
        style={{ left: px(leaf.slot * g.pageWidth), transformOrigin: `${leaf.origin} center`, transformPerspective: g.pageWidth * 5 }}
        custom={leaf.motion}
        variants={pageTurn}
        initial="flat"
        animate="turned"
        onAnimationComplete={finish}
      >
        <Face {...face} page={leaf.front[0]} side={leaf.front[1]} shade />
        {leaf.back && <Face {...face} page={leaf.back[0]} side={leaf.back[1]} className="rf-face-back" shade />}
      </m.div>
    </div>
  );
}
