import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { prefersReducedMotion } from '../motion/presets';
import { BookFlow } from './BookFlow';
import { PageTurn } from './PageTurn';
import { anchorForPage, pageForAnchor, pageOfElement } from './anchor';
import { clampPage, pageCount, pageGeometry } from './geometry';
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
  onPlaceChange, onPagesChange, onNearEnd, label,
}) {
  const frameRef = useRef(null);
  const flowRef = useRef(null);
  const bookRef = useRef(null);
  const size = useFrameSize(frameRef);
  const tick = useRelayoutTick();
  const g = useMemo(() => (size ? pageGeometry({ ...size, fontSize }) : null), [size, fontSize]);
  const anchor = useRef(initialAnchor);
  const [layout, setLayout] = useState({ count: 1, chapters: [], ms: 0 });
  const [page, setPage] = useState(0);
  const [turn, setTurn] = useState(null); // { id, from, to, dir } while a leaf is turning (C12.4)
  const queued = useRef(null); // the page asked for while a leaf was turning; the latest wins
  const swipe = useRef(null);

  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!g || !flow) return;
    const started = performance.now();
    const count = pageCount(flow.scrollWidth, g); // forces the column layout at the new size
    const chapters = [...flow.querySelectorAll('.rf-chapter')].map((el) => ({
      page: pageOfElement(flow, el, g), title: el.querySelector('.rf-chapter-title')?.textContent ?? '',
    }));
    const target = clampPage(pageForAnchor(flow, anchor.current, g), count, g.perView);
    setLayout({ count, chapters, ms: performance.now() - started });
    setPage(target);
  }, [g, blocks, tick]);

  useEffect(() => {
    onPagesChange?.({ page, count: layout.count, perView: g?.perView ?? 1 });
    // Within the last two views of today's pages: time to fetch what comes next (C12.4).
    if (g && page + 2 * g.perView >= layout.count) onNearEnd?.();
  }, [page, layout.count, g, onPagesChange, onNearEnd]);

  const goTo = useCallback((next) => {
    const flow = flowRef.current;
    if (!g || !flow) return;
    const target = clampPage(next, layout.count, g.perView);
    if (turn) { // a leaf is still turning: go there when it lands
      queued.current = target;
      return;
    }
    if (target === page) return;
    if (!prefersReducedMotion()) setTurn({ id: Date.now(), from: page, to: target, dir: target > page ? 1 : -1 });
    setPage(target); // reduced motion: an instant swap
    const place = anchorForPage(flow, target, g); // x is measured from the flow, so the old translate does not matter
    if (place) {
      anchor.current = place;
      onPlaceChange?.(place, target);
    }
  }, [g, layout.count, onPlaceChange, page, turn]);

  const onTurnDone = useCallback(() => setTurn(null), []);
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
    else if (event.key === 'Home') goTo(0);
    else if (event.key === 'End') goTo(layout.count - 1);
    else return;
    event.preventDefault();
  };

  const chapterOn = (p) => layout.chapters.filter((c) => c.page <= p).at(-1)?.title || chapterBefore;
  const opens = (p) => layout.chapters.some((c) => c.page === p);
  const last = Math.min(layout.count, page + step);
  const status = step === 2 && last > page + 1
    ? `pp. ${page + 1}–${last} of ${layout.count}`
    : `p. ${page + 1} of ${layout.count}`;
  const spoken = step === 2 && last > page + 1
    ? `Pages ${page + 1} and ${last} of ${layout.count}`
    : `Page ${page + 1} of ${layout.count}`;

  // Running head and folio of page p on a side. Spread: book title left, chapter right. One page:
  // "Book · Chapter" (handoff, 375 px).
  const furniture = (p, side) => {
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
                <div className="rf-leaf" data-side={side} key={side} style={{ left: px(k * g.pageWidth) }} aria-hidden="true">
                  {p < layout.count && furniture(p, side)}
                </div>
              );
            })}
            <div className="rf-viewport">
              <div className="rf-flow" lang={lang} ref={flowRef} style={{ transform: `translateX(${-page * g.stride}px)` }}>
                <BookFlow blocks={blocks} />
              </div>
            </div>
            {/* Its own AnimatePresence: the routes' initial={false} would otherwise skip the leaf's start state. */}
            <AnimatePresence>
              {turn && (
                <PageTurn key={turn.id} turn={turn} g={g} blocks={blocks} lang={lang} count={layout.count}
                  furniture={furniture} onDone={onTurnDone} />
              )}
            </AnimatePresence>
            {/* The outer page edges turn the page for a pointer; keyboard users have the keys and buttons. */}
            <button type="button" className="rf-edge" data-edge="back" tabIndex={-1} aria-hidden="true"
              onClick={() => onEdge(-step)} disabled={page === 0} />
            <button type="button" className="rf-edge" data-edge="forward" tabIndex={-1} aria-hidden="true"
              onClick={() => onEdge(step)} disabled={last >= layout.count} />
          </div>
          <div className="rf-status">
            <button type="button" className="rf-turn" onClick={() => turnFrom(-step)} disabled={page === 0} aria-label="Previous page">
              <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <p className="rf-page-status">{status}</p>
            <button type="button" className="rf-turn" onClick={() => turnFrom(step)} disabled={last >= layout.count} aria-label="Next page">
              <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <p className="rf-live" aria-live="polite" aria-atomic="true">{spoken}</p>
        </>
      )}
    </section>
  );
}
