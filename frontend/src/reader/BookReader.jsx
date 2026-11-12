import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { easing, prefersReducedMotion, seconds } from '../motion/presets';
import { BookFlow } from './BookFlow';
import { PageTurn } from './PageTurn';
import { anchorForPage, pageForAnchor, pageOfElement } from './anchor';
import { clampPage, pageCount, pageGeometry } from './geometry';
import { useWordAtPoint } from './useWordAtPoint';
import { WordCard } from './WordCard';
import { PhraseChip } from './PhraseChip';
import { useWordCard } from './useWordCard';
import { cardContent } from './lookup';
import './reader.css';

/** The frame's size, rounded, updated by a ResizeObserver. */
function useFrameSize(ref) {
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Changes that move text without resizing the frame: the theme or accent on <html>, and fonts arriving. */
function useRelayoutTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
    document.fonts?.addEventListener('loadingdone', bump);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', bump);
    };
  }, []);
  return tick;
}

const px = (n) => `${n}px`;

/**
 * Today's reading as a paginated book (C12.3): a two-page spread from
 * 1024 px, one page below. The place is an anchor ({block_id, char_offset});
 * after any re-pagination the page holding it is shown again, and only the
 * reader's own page turns move it.
 */
export function BookReader({
  blocks, bookTitle, chapterBefore = '', fontSize = 18, initialAnchor = null, lang = 'en',
  onPlaceChange, onPagesChange, onNearEnd, label, lead = null, endPage = null, pacing = false, onBookmark, statusNote, onLookup, lookupClient, hoverLookup = true, ref,
}) {
  const frameRef = useRef(null);
  const flowRef = useRef(null);
  const bookRef = useRef(null);
  const markRef = useRef(null); // the highlight's fallback layer, under the text
  const size = useFrameSize(frameRef);
  const tick = useRelayoutTick();
  const g = useMemo(() => (size ? pageGeometry({ ...size, fontSize }) : null), [size, fontSize]);
  const anchor = useRef(initialAnchor);
  // count: every page, the closing page included; text: pages of today's text (C12.5a).
  const [layout, setLayout] = useState({ count: 1, text: 1, chapters: [], ms: 0 });
  const [page, setPage] = useState(0);
  const [turn, setTurn] = useState(null); // { id, from, to, dir } while a leaf is turning (C12.4)
  const queued = useRef(null); // the page asked for while a leaf was turning; the latest wins
  const atEnd = useRef(false); // on the closing page alone, which has no anchor in the text
  const swipe = useRef(null);
  const hasEnd = Boolean(endPage);

  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!g || !flow) return;
    const started = performance.now();
    const text = pageCount(flow.scrollWidth, g); // forces the column layout at the new size
    const count = text + (hasEnd ? 1 : 0);
    const chapters = [...flow.querySelectorAll('.rf-chapter')].map((el) => ({
      page: pageOfElement(flow, el, g), title: el.querySelector('.rf-chapter-title')?.textContent ?? '',
    }));
    const target = atEnd.current && hasEnd
      ? clampPage(count - 1, count, g.perView)
      : clampPage(pageForAnchor(flow, anchor.current, g), count, g.perView);
    setLayout({ count, text, chapters, ms: performance.now() - started });
    setPage(target);
  }, [g, blocks, tick, lead, hasEnd]); // lead is memoised by the caller; the closing page only adds a page

  useEffect(() => {
    const shown = Math.min(page + (g?.perView ?? 1), layout.text) - 1;
    const chapter = layout.chapters.filter((c) => c.page <= shown).at(-1)?.title || chapterBefore;
    onPagesChange?.({ page, count: layout.count, text: layout.text, perView: g?.perView ?? 1, chapter });
    // Within the last two views of today's pages: time to fetch what comes next (C12.4).
    if (g && page + 2 * g.perView >= layout.count) onNearEnd?.();
  }, [page, layout, g, onPagesChange, onNearEnd, chapterBefore]);

  const goTo = useCallback((next) => {
    const flow = flowRef.current;
    if (!g || !flow) return;
    const target = clampPage(next, layout.count, g.perView);
    if (turn) { // a leaf is still turning: go there when it lands
      queued.current = target;
      return;
    }
    if (target === page) return;
    atEnd.current = hasEnd && target >= layout.text;
    if (!prefersReducedMotion()) setTurn({ id: Date.now(), from: page, to: target, dir: target > page ? 1 : -1 });
    setPage(target); // reduced motion: an instant swap
    const place = anchorForPage(flow, target, g); // x is measured from the flow, so the old translate does not matter
    if (place) {
      anchor.current = place;
      onPlaceChange?.(place, target);
    }
  }, [g, hasEnd, layout.count, layout.text, onPlaceChange, page, turn]);

  const onTurnDone = useCallback(() => setTurn(null), []);
  // In-place lookup (C12.7): only when the page asks for it; off until the flow is laid out and while a leaf turns.
  // The word card (C12.8) when the page passes a lookup client; closing it removes the mark.
  const clearMark = useRef(() => {});
  const { card, open: openCard, close: closeCard, cardRef } = useWordCard({
    client: lookupClient, returnFocusTo: bookRef, onClosed: () => clearMark.current(),
  });
  const onTarget = useCallback((target) => {
    onLookup?.(target);
    if (lookupClient) openCard(target, target.by);
  }, [onLookup, lookupClient, openCard]);
  // A 2-5 word touch selection offering "Look up" (C12.9); it belongs to the page it was made on.
  const [chip, setChip] = useState(null); // { target, page }
  const onChip = useCallback((target) => setChip(target && { target, page }), [page]);
  const { clear: clearLookup, clearMark: clearLookupMark, lookUpSelection, lookUp } = useWordAtPoint(flowRef, markRef, {
    onLookup: onLookup || lookupClient ? onTarget : undefined, onChip: lookupClient ? onChip : undefined,
    lang, paused: !g || Boolean(turn), hover: hoverLookup,
  });
  useEffect(() => { clearMark.current = clearLookupMark; }, [clearLookupMark]);
  useEffect(() => { // the marked word has moved or left the page
    clearLookup();
    closeCard(false);
  }, [page, g, clearLookup, closeCard]);
  const announce = card ? cardContent(card.state, card.target).announce : '';
  // For the contents drawer (C12.5b): open the page holding a place.
  useImperativeHandle(ref, () => ({
    goToPlace(place) {
      const flow = flowRef.current;
      if (flow && g) goTo(pageForAnchor(flow, place, g));
    },
  }), [g, goTo]);

  // The ribbon bookmark (C12.5b): save the first place on this view now; it drops in again each time.
  const [drops, setDrops] = useState(0);
  const bookmark = () => {
    const flow = flowRef.current;
    if (!flow || !g || page >= layout.text) return;
    const place = anchorForPage(flow, page, g);
    if (!place) return;
    anchor.current = place;
    setDrops((n) => n + 1);
    onBookmark?.(place, page + 1);
  };
  useEffect(() => {
    if (turn || queued.current === null) return;
    const next = queued.current;
    queued.current = null;
    goTo(next);
  }, [turn, goTo]);

  const step = g?.perView ?? 1;
  // Relative moves count from where the reader is headed: five quick presses during a turn are five views.
  const goBy = (delta) => goTo((queued.current ?? page) + delta);
  // A turn button that is about to be disabled hands focus to the book, so focus stays in the reader.
  const turnFrom = (delta) => {
    const target = clampPage((queued.current ?? page) + delta, layout.count, step);
    goBy(delta);
    if (target === 0 || target + step >= layout.count) bookRef.current?.focus();
  };
  const onEdge = (delta) => { goBy(delta); bookRef.current?.focus(); };
  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse') return;
    swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) goBy(dx < 0 ? step : -step);
  };
  const onKeyDown = (event) => {
    const forward = ['ArrowRight', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
    const back = ['ArrowLeft', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey);
    if (forward) goBy(step);
    else if (back) goBy(-step);
    else if ((event.key === 'b' || event.key === 'B') && onBookmark) bookmark();
    else if (event.key === 'Home') goTo(0);
    else if (event.key === 'End') goTo(layout.count - 1);
    else if (event.key === 'Escape' && (onLookup || lookupClient)) clearLookup();
    else if ((event.key === 'Enter' || event.key === '?') && lookupClient && lookUpSelection()) { /* the card opens with focus */ }
    else return;
    event.preventDefault();
  };

  const chapterOn = (p) => layout.chapters.filter((c) => c.page <= p).at(-1)?.title || chapterBefore;
  const opens = (p) => layout.chapters.some((c) => c.page === p);
  const last = Math.min(layout.count, page + step);
  const status = step === 2 && last > page + 1
    ? `pp. ${page + 1}–${last} of ${layout.count}`
    : `p. ${page + 1} of ${layout.count}`;
  const spoken = page >= layout.text ? "End of today's reading"
    : step === 2 && Math.min(last, layout.text) > page + 1
      ? `Pages ${page + 1} and ${Math.min(last, layout.text)} of ${layout.text}`
      : `Page ${page + 1} of ${layout.text}`;
  // Session pacing (C12.5a): how much of today's text is left, as words and a hairline that fills.
  const left = Math.max(0, layout.text - (page + step));
  const pacingText = page + step > layout.text ? "That's today's reading"
    : left === 0 ? "Last page of today's reading"
      : `${left} ${left === 1 ? 'page' : 'pages'} left in today's reading`;
  const progress = Math.min(1, (page + step) / Math.max(1, layout.text));
  const isEnd = (p) => endPage && p === layout.text;

  // Running head and folio of page p on a side. Spread: book title left, chapter right. One page:
  // "Book · Chapter" (handoff, 375 px).
  const furniture = (p, side) => {
    if (isEnd(p)) return <div className="rf-end">{endPage}</div>; // the closing page, outside the flow
    const chapter = chapterOn(p);
    const head = side === 'left' ? bookTitle
      : side === 'right' ? chapter || bookTitle
        : [bookTitle, chapter].filter(Boolean).join(' · ');
    return (
      <>
        <p className="rf-running-head running-head" data-hidden={opens(p)}>{head}</p>
        <p className="rf-folio">{p + 1}</p>
      </>
    );
  };

  return (
    <section className="rf-reader" ref={frameRef} aria-label={label ?? bookTitle}>
      {g && (
        <>
          <div
            className="rf-book"
            ref={bookRef}
            data-spread={g.spread}
            data-flush={g.flush}
            data-turning={turn ? 'true' : 'false'}
            data-ribbon={onBookmark ? 'true' : undefined}
            data-paginate-ms={layout.ms.toFixed(1)}
            role="region"
            aria-roledescription="book"
            aria-label={`${bookTitle}. Arrow keys, Page Up and Page Down, or Space turn the page.`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { swipe.current = null; }}
            style={{
              width: px(g.perView * g.pageWidth), height: px(g.pageHeight),
              '--page-w': px(g.pageWidth), '--margin': px(g.margin), '--head': px(g.head), '--foot': px(g.foot),
              '--text-h': px(g.textHeight), '--column': px(g.column), '--gap': px(g.gap),
              '--reading-size': px(fontSize),
            }}
          >
            {Array.from({ length: g.perView }, (_, k) => {
              const p = page + k;
              const side = g.spread ? (k === 0 ? 'left' : 'right') : 'single';
              return (
                <div className="rf-leaf" data-side={side} key={side} style={{ left: px(k * g.pageWidth) }} aria-hidden={isEnd(p) ? undefined : 'true'}>
                  {p < layout.count && furniture(p, side)}
                </div>
              );
            })}
            {(onLookup || lookupClient) && <div className="rf-mark-layer" ref={markRef} aria-hidden="true" />}
            <div className="rf-viewport">
              <div className="rf-flow" lang={lang} ref={flowRef} style={{ transform: `translateX(${-page * g.stride}px)` }}>
                <BookFlow blocks={blocks} lead={lead} />
              </div>
            </div>
            {/* Its own AnimatePresence: the routes' initial={false} would otherwise skip the leaf's start state. */}
            <AnimatePresence>
              {turn && (
                <PageTurn key={turn.id} turn={turn} g={g} blocks={blocks} lead={lead} lang={lang} count={layout.count}
                  furniture={furniture} onDone={onTurnDone} />
              )}
            </AnimatePresence>
            {/* The outer page edges turn the page for a pointer; keyboard users have the keys and buttons. */}
            <button type="button" className="rf-edge" data-edge="back" tabIndex={-1} aria-hidden="true"
              onClick={() => onEdge(-step)} disabled={page === 0} />
            <button type="button" className="rf-edge" data-edge="forward" tabIndex={-1} aria-hidden="true"
              onClick={() => onEdge(step)} disabled={last >= layout.count} />
            {onBookmark && page < layout.text && (
              // D2: in the outer margin of the right-hand page, never over the text.
              <button type="button" className="rf-ribbon" onClick={bookmark} aria-label="Save my place" aria-keyshortcuts="B"
                title="Save my place (B)">
                <m.span
                  key={drops}
                  className="rf-ribbon-tail"
                  aria-hidden="true"
                  initial={drops ? { y: '-40%' } : false}
                  animate={{ y: 0 }}
                  transition={{ duration: seconds('--dur-4'), ease: easing('--ease-arrive') }}
                />
              </button>
            )}
          </div>
          <div className="rf-status">
            <button type="button" className="rf-turn" onClick={() => turnFrom(-step)} disabled={page === 0} aria-label="Previous page">
              <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {pacing ? (
              <div className="rf-pacing">
                <span className="rf-pacing-track" aria-hidden="true">
                  <span className="rf-pacing-fill" style={{ transform: `scaleX(${progress})` }} />
                </span>
                <p className="rf-page-status">{pacingText}</p>
              </div>
            ) : <p className="rf-page-status">{statusNote ? `${statusNote} · ${status}` : status}</p>}
            <button type="button" className="rf-turn" onClick={() => turnFrom(step)} disabled={last >= layout.count} aria-label="Next page">
              <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <p className="rf-live" aria-live="polite" aria-atomic="true">{spoken}</p>
          {lookupClient && <p className="rf-live" aria-live="polite" aria-atomic="true">{announce}</p>}
          {card && <WordCard card={card} cardRef={cardRef} onClose={closeCard} />}
          {chip?.page === page && !turn && !card && (
            <PhraseChip target={chip.target} onLookUp={() => { lookUp(chip.target, 'chip'); setChip(null); }} />
          )}
        </>
      )}
    </section>
  );
}
