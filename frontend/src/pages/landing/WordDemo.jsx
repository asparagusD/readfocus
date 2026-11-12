import { Fragment, useEffect, useRef } from 'react';
import { WordCard } from '../../reader/WordCard';
import { useWordCard } from '../../reader/useWordCard';
import { HOVER_MS } from '../../reader/useWordAtPoint';
import { createLongPress } from '../../reader/longPress';
import { cardContent } from '../../reader/lookup';
import { SOURCE } from './passages';
import DEFINITIONS from './demoDefinitions.json';

/** Book I, XV, split at the marked words: [text, term, text, term, ...]. */
const PASSAGE = [
  'XV. In the country of the ', 'Quadi', ' at Granua, these. ', 'Betimes',
  ' in the morning say to thyself, This day I shalt have to do with an idle curious man, with an unthankful man, a railer, a crafty, false, or an envious man; an unsociable uncharitable man. All these ill qualities have happened unto them, through ignorance of that which is truly good and truly bad. But I that understand the nature of that which is good, that it only is to be desired, and of that which is bad, that it only is truly ',
  'odious', ' and shameful: who know moreover, that this transgressor, ', 'whosoever', ' he be, is my ', 'kinsman',
  ', not by the same blood and seed, but by participation of the same reason, and of the same divine particle; How can I either be hurt by any of those, since it is not in their power to make me ',
  'incur', ' anything that is truly ', 'reproachful', '?',
];

/** The bundled answers, in the shape GET /lookup returns, so the card renders exactly as in the reader. */
const client = {
  get: (target) => Promise.resolve({ status: 'ready', data: DEFINITIONS.entries[target.term] }),
};

function targetOf(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const term = el.dataset.term;
  return { kind: 'word', term, proper: DEFINITIONS.entries[term].source === 'wikipedia', range };
}

/**
 * Try it (C13.10c): a passage with a few marked words that open the reader's own WordCard.
 * Mouse: rest on a word (the reader's hover delay). Touch: press and hold (450 ms). Keyboard:
 * Tab to a word, Enter opens the card and focuses it, Esc closes it and returns to the word.
 * Answers come from demoDefinitions.json, so the demo makes no network calls.
 */
export function WordDemo() {
  const lastWord = useRef(null);
  const hover = useRef(0);
  const pointer = useRef('mouse');
  const held = useRef(false);
  const { card, open, close, cardRef } = useWordCard({ client, returnFocusTo: lastWord });

  // The long-press machine is made on first use, in an event, and calls the latest onHold.
  const onHold = useRef(null);
  const pressMachine = useRef(null);
  useEffect(() => {
    onHold.current = ({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest('[data-term]');
      if (el) { lastWord.current = el; open(targetOf(el), 'press'); }
    };
  }, [open]);
  useEffect(() => () => clearTimeout(hover.current), []);
  const press = () => (pressMachine.current ??= createLongPress({ onHold: (point) => onHold.current?.(point) }));

  const show = (el, by) => { lastWord.current = el; open(targetOf(el), by); };
  const handlers = {
    onPointerEnter: (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const el = e.currentTarget;
      clearTimeout(hover.current);
      hover.current = setTimeout(() => show(el, 'hover'), HOVER_MS);
    },
    onPointerLeave: () => clearTimeout(hover.current),
    onPointerDown: (e) => {
      pointer.current = e.pointerType;
      press().down({ x: e.clientX, y: e.clientY, pointerType: e.pointerType });
    },
    onPointerMove: (e) => press().move({ x: e.clientX, y: e.clientY }),
    onPointerUp: () => { held.current = press().up(); },
    onPointerCancel: () => { press().up(); },
    onContextMenu: (e) => e.preventDefault(), // a held word opens the card, not the browser menu
    // Enter or Space (detail 0) opens and focuses the card; a click or tap opens it too, except
    // the release of a long-press, which has already opened it.
    onClick: (e) => {
      if (e.detail === 0) return show(e.currentTarget, 'key');
      if (held.current) { held.current = false; return undefined; }
      return show(e.currentTarget, pointer.current === 'touch' ? 'press' : 'select');
    },
  };

  const announce = card ? cardContent(card.state, card.target).announce : '';

  return (
    <section className="rf-demo" aria-labelledby="demo-title">
      <div className="rf-demo__intro">
        <h2 id="demo-title" className="rf-demo__title">Try it: hover a word</h2>
        <p className="rf-demo__hint">
          <span className="rf-demo__hint-pointer">Rest the pointer on an underlined word, or Tab to one and press Enter.</span>
          <span className="rf-demo__hint-touch">Press and hold an underlined word.</span>
          {' '}This is the card the reader uses. Here its answers are bundled with the page; in the
          app they come from a dictionary and Wikipedia as you read.
        </p>
      </div>
      <figure className="rf-demo__page">
        <p className="rf-demo__text">
          {PASSAGE.map((part, i) => (i % 2 === 1
            ? (
              <button key={part} type="button" className="rf-demo__word" data-term={part} aria-haspopup="dialog"
                aria-expanded={card?.target.term === part} {...handlers}>
                {part}
              </button>
            )
            : <Fragment key={i}>{part}</Fragment>))}
        </p>
        <figcaption className="rf-demo__caption">
          {SOURCE.author}, <cite>{SOURCE.title}</cite>, Book I, XV, translated by {SOURCE.translator} ({SOURCE.year}).
        </figcaption>
      </figure>
      <p className="rf-demo__live" aria-live="polite" aria-atomic="true">{announce}</p>
      {card && <WordCard key={card.id} card={card} cardRef={cardRef} onClose={close} />}
    </section>
  );
}
