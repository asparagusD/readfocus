import { useCallback, useId, useLayoutEffect, useRef } from 'react';
import { autoUpdate, flip, FloatingPortal, inline, offset, shift, useFloating } from '@floating-ui/react';
import { ArrowUpRight, X } from 'lucide-react';
import { cardContent } from './lookup';
import { sheetDrag } from './longPress';
import './WordCard.css';

/** Swipe down to close (C12.9): the sheet follows the finger down and closes past the threshold. */
function useSwipeDown(onClose) {
  const drag = useRef(null);
  const onPointerDown = (event) => {
    if (event.pointerType === 'touch') drag.current = { y: event.clientY, el: event.currentTarget };
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    drag.current.el.style.transition = 'none'; // follow the finger; the spring back is the CSS transition
    drag.current.el.style.transform = `translateY(${sheetDrag(event.clientY - drag.current.y).offset}px)`;
  };
  const onPointerUp = (event) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    d.el.style.transition = '';
    if (sheetDrag(event.clientY - d.y).close) onClose(false);
    else d.el.style.transform = '';
  };
  const onPointerCancel = () => {
    if (drag.current) Object.assign(drag.current.el.style, { transform: '', transition: '' });
    drag.current = null;
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}

/**
 * The card itself: placed beside the word by Floating UI, below it or above when there is no room.
 * Opened by touch (a long-press or the Look up chip) it is the handoff's compact sheet: a grab
 * handle, one sense, "Tap outside to close", and a swipe down closes it.
 */
export function WordCard({ card, cardRef, onClose }) {
  const titleId = useId();
  const content = cardContent(card.state, card.target);
  const compact = card.by === 'press' || card.by === 'chip';
  const swipe = useSwipeDown(onClose);
  const { refs, floatingStyles, placement } = useFloating({
    placement: 'bottom-start',
    strategy: 'fixed',
    transform: false, // top/left, so the entrance can use transform
    middleware: [inline(), offset(8), flip({ padding: 8, fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { range } = card.target;
  useLayoutEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => range.getBoundingClientRect(),
      getClientRects: () => range.getClientRects(),
      contextElement: range.startContainer.parentElement ?? undefined,
    });
  }, [refs, range]);
  // Only a card asked for from the keyboard takes focus. The portal mounts a frame late, so focus
  // is moved when the element arrives (the ref is re-attached when byKey changes).
  const byKey = card.by === 'key';
  const setRef = useCallback((el) => {
    refs.setFloating(el);
    cardRef.current = el;
    if (el && byKey) el.focus({ preventScroll: true });
  }, [refs, cardRef, byKey]);

  return (
    <FloatingPortal>
      <div
        ref={setRef}
        className="rf-wordcard"
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-kind={content.kind}
        data-side={placement.split('-')[0]}
        data-compact={compact || undefined}
        style={floatingStyles}
        {...(compact ? swipe : {})}
      >
        {compact && <span className="rf-wordcard-handle" aria-hidden="true" />}
        <div className="rf-wordcard-head">
          <h2 className="rf-wordcard-title" id={titleId}>{content.title}</h2>
          {content.phonetic && <span className="rf-wordcard-phonetic">{content.phonetic}</span>}
          <button type="button" className="rf-wordcard-close" onClick={() => onClose(true)} aria-label="Close">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <CardBody content={content} compact={compact} />
      </div>
    </FloatingPortal>
  );
}

function Source({ children, url, hint }) {
  return (
    <p className="rf-wordcard-source">
      <span>{children}</span>
      {!url && hint && <span>Tap outside to close</span>}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="rf-wordcard-link">
          Wikipedia <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="rf-wordcard-hidden"> (opens in a new tab)</span>
        </a>
      )}
    </p>
  );
}

function CardBody({ content, compact }) {
  switch (content.kind) {
    case 'loading':
      return (
        <div className="rf-wordcard-skeleton" aria-hidden="true">
          <span /><span /><span />
        </div>
      );
    case 'definition':
      return (
        <>
          <p className="rf-wordcard-kind">{content.pos}</p>
          {compact
            ? <p className="rf-wordcard-text">{content.senses[0]}</p>
            : <ol className="rf-wordcard-senses">{content.senses.map((s) => <li key={s}>{s}</li>)}</ol>}
          {content.example && !compact && <p className="rf-wordcard-example">“{content.example}”</p>}
          <Source hint={compact}>{compact ? 'Wiktionary' : 'Wiktionary, via Free Dictionary'}</Source>
        </>
      );
    case 'summary':
      return (
        <>
          {content.description && <p className="rf-wordcard-kind">{content.description}</p>}
          <p className="rf-wordcard-text">{content.extract}</p>
          <Source url={content.url}>Summary from Wikipedia</Source>
        </>
      );
    case 'ambiguous':
      return (
        <>
          <p className="rf-wordcard-text">This could mean several things.</p>
          <Source url={content.url}>See the choices on Wikipedia</Source>
        </>
      );
    case 'none':
      return (
        <>
          <p className="rf-wordcard-text">
            {content.phrase ? 'No definition found for this phrase. Try a single word.' : 'No definition found for this word.'}
          </p>
          <Source hint={compact}>Nothing in Wiktionary or Wikipedia</Source>
        </>
      );
    default:
      return <p className="rf-wordcard-text">{content.message || "We couldn't look this up right now."}</p>;
  }
}
