import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BookFlow } from './BookFlow';
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
  onPlaceChange, onPagesChange, label,
}) {
  const frameRef = useRef(null);
  const flowRef = useRef(null);
  const size = useFrameSize(frameRef);
  const tick = useRelayoutTick();
  const g = useMemo(() => (size ? pageGeometry({ ...size, fontSize }) : null), [size, fontSize]);
  const anchor = useRef(initialAnchor);
  const [layout, setLayout] = useState({ count: 1, chapters: [], ms: 0 });
  const [page, setPage] = useState(0);

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
  }, [page, layout.count, g, onPagesChange]);

  const goTo = useCallback((next) => {
    const flow = flowRef.current;
    if (!g || !flow) return;
    const target = clampPage(next, layout.count, g.perView);
    setPage(target);
    const place = anchorForPage(flow, target, g); // x is measured from the flow, so the old translate does not matter
    if (place) {
      anchor.current = place;
      onPlaceChange?.(place, target);
    }
  }, [g, layout.count, onPlaceChange]);

  const step = g?.perView ?? 1;
  const onKeyDown = (event) => {
    const forward = ['ArrowRight', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
    const back = ['ArrowLeft', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey);
    if (forward) goTo(page + step);
    else if (back) goTo(page - step);
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

  return (
    <section className="rf-reader" ref={frameRef} aria-label={label ?? bookTitle}>
      {g && (
        <>
          <div
            className="rf-book"
            data-spread={g.spread}
            data-flush={g.flush}
            data-paginate-ms={layout.ms.toFixed(1)}
            role="region"
            aria-roledescription="book"
            aria-label={`${bookTitle}, ${status}. Arrow keys turn the page.`}
            tabIndex={0}
            onKeyDown={onKeyDown}
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
              const chapter = chapterOn(p);
              // Spread: book title left, chapter right. One page: "Book · Chapter" (handoff, 375 px).
              const head = side === 'left' ? bookTitle
                : side === 'right' ? chapter || bookTitle
                  : [bookTitle, chapter].filter(Boolean).join(' · ');
              return (
                <div className="rf-leaf" data-side={side} key={side} style={{ left: px(k * g.pageWidth) }} aria-hidden="true">
                  {p < layout.count && (
                    <>
                      <p className="rf-running-head running-head" data-hidden={opens(p)}>{head}</p>
                      <p className="rf-folio">{p + 1}</p>
                    </>
                  )}
                </div>
              );
            })}
            <div className="rf-viewport">
              <div className="rf-flow" lang={lang} ref={flowRef} style={{ transform: `translateX(${-page * g.stride}px)` }}>
                <BookFlow blocks={blocks} />
              </div>
            </div>
          </div>
          <div className="rf-status">
            <button type="button" className="rf-turn" onClick={() => goTo(page - step)} disabled={page === 0} aria-label="Previous page">
              <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <p className="rf-page-status" aria-live="polite">{status}</p>
            <button type="button" className="rf-turn" onClick={() => goTo(page + step)} disabled={last >= layout.count} aria-label="Next page">
              <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
