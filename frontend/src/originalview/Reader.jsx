import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { easing, prefersReducedMotion, seconds } from '../motion/presets';
import { Button } from '../components/ui/Button';
import { BookLookup } from './BookLookup';
import { SelectionToolbar } from '../annotations/SelectionToolbar';
import { useSelection } from '../annotations/useSelection';
import { PdfBlockActions } from '../steve/PdfBlockActions';
import { EpubBlockActions } from '../steve/EpubBlockActions';
import { EpubBook } from './epub/EpubBook';
import { PdfBook } from './pdf/PdfBook';
import { skipPdfPoint } from './pdf/regions';
import { keyAction, SPREAD_MIN_WIDTH, timeAtProgress } from './frame';
import { placeEnd, placeStart, reached, shows } from './today';

/** "5" for a PDF page, "2:340" for an EPUB section and character: the place's ends, for tests and tools. */
const spot = (loc) => (loc.kind === 'pdf' ? String(loc.page) : `${loc.index}:${loc.char}`);
import { useLamplight } from './useLamplight';
import './frame.css';

const SWIPE_PX = 48;
const EXTEND = { ArrowRight: 'forward', ArrowDown: 'forward', ArrowLeft: 'backward', ArrowUp: 'backward' };

/** Shift+arrows grow or shrink a selection in the book (C21.2): by character, by word with Ctrl, by line up and down. */
function extendSelection(found, event) {
  const selection = found?.document?.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !selection.modify) return false;
  const granularity = event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 'line' : event.ctrlKey ? 'word' : 'character';
  selection.modify('extend', EXTEND[event.key], granularity);
  return true;
}

/** True from SPREAD_MIN_WIDTH up: two pages side by side (C12, handoff 11-12). */
function useWide() {
  const query = `(min-width: ${SPREAD_MIN_WIDTH}px)`;
  const [wide, setWide] = useState(() => globalThis.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const list = globalThis.matchMedia?.(query);
    const change = () => setWide(list.matches);
    list?.addEventListener('change', change);
    return () => list?.removeEventListener('change', change);
  }, [query]);
  return wide;
}

/**
 * One leaf turning over the page (C17.4), the same for both renderers: a sheet of
 * paper hinged at the spine fades in over the outgoing page, swings across, and
 * fades onto the other side. The renderer moves at the halfway point, under the
 * leaf, so neither renderer has to draw the next page early. Only transform and
 * opacity move, with the --dur-5 and --ease-settle tokens, through the Web
 * Animations API (an m.div leaf jumped to its end state here; DEBUG_LOG C17.4).
 */
function TurnLeaf({ turn, wide, onMiddle, onDone }) {
  const leaf = useRef(null);
  const shade = useRef(null);
  const side = wide ? (turn.dir > 0 ? 'right' : 'left') : (turn.dir > 0 ? 'single' : 'single-back');
  useEffect(() => {
    const duration = seconds('--dur-5') * 1000;
    const curve = easing('--ease-settle');
    const edge = timeAtProgress(curve, 0.5); // the leaf stands on edge: the page changes under it
    const to = turn.dir > 0 ? -180 : 180;
    const swing = leaf.current?.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${to}deg)` }],
      { duration, easing: `cubic-bezier(${curve.join(', ')})`, fill: 'forwards' });
    const fade = leaf.current?.animate([{ opacity: 0 }, { opacity: 1, offset: edge * 0.6 }, { opacity: 1, offset: edge * 1.6 }, { opacity: 0 }],
      { duration, easing: 'linear', fill: 'forwards' });
    shade.current?.animate([{ opacity: 0 }, { opacity: 0.6, offset: edge }, { opacity: 0 }], { duration, easing: 'linear' });
    const middle = setTimeout(onMiddle, duration * edge);
    const done = setTimeout(onDone, duration + 60); // ends the turn even if the animation is cut short
    return () => { clearTimeout(middle); clearTimeout(done); swing?.cancel(); fade?.cancel(); };
  }, [turn.id]); // eslint-disable-line react-hooks/exhaustive-deps -- one leaf per turn
  return (
    <div ref={leaf} className="rf-ov-leaf" data-side={side} aria-hidden="true">
      <div ref={shade} className="rf-ov-shade" data-side={side} />
    </div>
  );
}

/**
 * A book shown as published, PDF or EPUB, in one frame (C17.4): a spread from
 * 1024 px and one page below, the running header (title, contents entry) and the
 * ribbon outside the page, a folio under it, page turns by keys, edge clicks and
 * swipes, and lamplight colours that never touch images. `ref` gets
 * { goTo(anchor), next(), prev(), visibleRange(), getSelection(), documents() }.
 * onRelocate(place) on every move; onBookmark(anchor) from the ribbon or B.
 *
 * A reading session (C17.5) passes `bounds` ({ start, end } locations, today.js): `note`
 * shows over the pages holding the start until hidden; past the end (Next, Space, End)
 * the `closing` page covers the book and Previous comes back; Home goes to the start.
 * `opening` keeps the blank page up while the session finds and opens its place; `status`
 * joins the folio ("Beyond today's reading"). `ref` also gets find(snippets, from) and toc().
 * With a `lookupClient`, words are looked up in place in both renderers (BookLookup;
 * `hoverLookup` false leaves selection, long-press and Enter). `regions` (pdf/regions.js, C18.6d)
 * keeps a PDF's math, code, figures and tables out of lookup, as the EPUB's markup already does.
 */
export function Reader({
  kind, bookId, load, title, zoom = 'fit-page', settings = { style: 'publisher', fontSize: 18, lineHeight: null, margins: 'normal' },
  onRelocate, onBookmark, onReady, onBack, label, ref, bounds = null, note = null, closing = null, opening = false, status = null, lookupClient = null, hoverLookup = true, regions = null, ocr = null, onAnnotate = null, annotations = null,
}) {
  const wide = useWide();
  const { colours, theme, original } = useLamplight(bookId);
  const book = useRef(null);
  const [place, setPlace] = useState(null);
  const [turn, setTurn] = useState(null);
  const [failure, setFailure] = useState(null);
  const [attempt, setAttempt] = useState(0); // Try again remounts the renderer
  const [sheet, setSheet] = useState(null); // a PDF spread's width: header, footer and ribbon follow it
  const swipe = useRef(null);
  const stage = useRef(null);
  const busy = useRef(false);
  const queued = useRef(0); // a turn asked for mid-turn runs when the leaf lands (C12)
  const moveRef = useRef(null);
  const [ending, setEnding] = useState(false); // the closing page is shown
  const [noteHidden, setNoteHidden] = useState(false);
  // Lookup (C17.5): where the book is drawn. A PDF is drawn in this page (its text layers in the
  // book box); an EPUB in one iframe per section shown, added as each loads.
  const [bookBox, setBookBox] = useState(null);
  const [sections, setSections] = useState([]);
  const lookup = useRef(null);
  const surfaces = useMemo(() => (kind === 'pdf'
    ? (bookBox ? [{ root: bookBox, doc: document, skip: regions ? (x, y) => skipPdfPoint(regions, x, y) : undefined }] : [])
    : sections.filter((doc) => doc.defaultView && doc.body).map((doc) => ({ root: doc.body, doc }))), [kind, bookBox, sections, regions]);
  const shownPages = place?.kind === 'pdf' ? place.pages.join() : '';
  // C21.2: the settled selection, for the highlight toolbar: in this page for a PDF, in each section for an EPUB.
  const selectionDocs = useMemo(() => (kind === 'pdf' ? [document] : sections.filter((doc) => doc.defaultView)), [kind, sections]);
  const skipAt = useMemo(() => (kind === 'pdf' && regions ? (x, y) => skipPdfPoint(regions, x, y) : undefined), [kind, regions]);
  const toolbar = useRef(null);
  useEffect(() => { // C18.6d: the boxes of the pages shown are asked for before a word is hovered
    if (regions && shownPages) shownPages.split(',').forEach((n) => regions.load(Number(n)));
  }, [regions, shownPages]);

  const relocate = useCallback((next) => {
    setPlace(next);
    onRelocate?.(next);
  }, [onRelocate]);
  useEffect(() => { if (place) onReady?.(); }, [Boolean(place)]); // eslint-disable-line react-hooks/exhaustive-deps -- first place only

  const { place: selected, dismiss: dismissSelection } = useSelection({
    book, docs: selectionDocs, skipAt, paused: !onAnnotate || !place || opening || ending || Boolean(turn) || Boolean(failure),
  });

  const move = useCallback(async (dir) => {
    const renderer = book.current;
    if (!renderer) return false;
    if (busy.current) {
      queued.current = dir;
      return true;
    }
    if (ending) {
      if (dir < 0) setEnding(false);
      return dir < 0;
    }
    if (dir > 0 && closing && (reached(place, bounds?.end) || place?.atEnd)) {
      setEnding(true);
      return true;
    }
    if ((dir > 0 && place?.atEnd) || (dir < 0 && place?.atStart)) return false;
    if (prefersReducedMotion()) return dir > 0 ? renderer.next() : renderer.prev();
    busy.current = true;
    setTurn({ id: Date.now(), dir });
    return true;
  }, [place, ending, closing, bounds]);
  useEffect(() => { moveRef.current = move; });

  const act = useCallback((action) => {
    const renderer = book.current;
    if (!renderer) return;
    if (action === 'next') move(1);
    else if (action === 'prev') move(-1);
    else if (action === 'first') {
      setEnding(false);
      if (bounds?.start) renderer.goTo(bounds.start);
      else renderer.first();
    } else if (action === 'last' && closing) {
      if (bounds?.end) renderer.goTo(bounds.end);
      else renderer.last();
      setEnding(true);
    } else if (action === 'last') renderer.last();
    else if (action === 'ribbon' && onBookmark) onBookmark(renderer.anchor());
  }, [move, onBookmark, bounds, closing]);

  const onKey = useCallback((event) => {
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (event.shiftKey && EXTEND[event.key] && !event.altKey && !event.metaKey && extendSelection(book.current?.getSelection(), event)) {
      event.preventDefault();
      return;
    }
    if (onAnnotate && toolbar.current?.onKey(event)) return;
    if (lookupClient && (event.key === 'Enter' || event.key === '?') && lookup.current?.lookUpSelection()) {
      event.preventDefault(); // the card opens with focus
      return;
    }
    if (event.key === 'Escape') {
      lookup.current?.clear();
      dismissSelection();
    }
    const action = keyAction(event);
    if (!action || (action === 'ribbon' && !onBookmark)) return;
    event.preventDefault();
    act(action);
  }, [act, onBookmark, lookupClient, onAnnotate, dismissSelection]);

  const onKeyRef = useRef(null);
  const swipeStart = useRef(null);
  const swipeEnd = useRef(null);
  useEffect(() => {
    onKeyRef.current = onKey;
    swipeStart.current = (event) => {
      if (event.pointerType === 'mouse' || book.current?.panning()) return;
      swipe.current = { x: event.clientX, y: event.clientY };
    };
    swipeEnd.current = (event) => {
      const start = swipe.current;
      swipe.current = null;
      if (!start) return;
      const dx = event.clientX - start.x;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.5) move(dx < 0 ? 1 : -1);
    };
  });

  // Keys and swipes inside an EPUB section reach us too (it lives in an iframe).
  const watched = useRef(new WeakSet());
  const onDocument = useCallback((doc) => {
    if (watched.current.has(doc)) return;
    watched.current.add(doc);
    doc.addEventListener('keydown', (e) => onKeyRef.current?.(e));
    doc.addEventListener('pointerdown', (e) => swipeStart.current?.(e));
    // The page hears what happens in the section too, in its own coordinates: the word card closes
    // on a press or when the pointer leaves the word, Esc closes it, and the toolbar wakes on movement.
    const relay = (e) => {
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
      if (!frame) return;
      document.dispatchEvent(new PointerEvent(e.type, {
        bubbles: true, clientX: e.clientX + frame.left, clientY: e.clientY + frame.top,
        pointerType: e.pointerType, buttons: e.buttons, movementX: e.movementX, movementY: e.movementY,
      }));
    };
    doc.addEventListener('pointermove', relay);
    doc.addEventListener('pointerdown', relay);
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    setSections((list) => [...list.filter((d) => d.defaultView && d !== doc), doc]);
    doc.addEventListener('pointerup', (e) => swipeEnd.current?.(e));
  }, []);

  useImperativeHandle(ref, () => ({
    goTo: (anchor) => { setEnding(false); return book.current?.goTo(anchor); },
    find: (snippets, from) => book.current?.find(snippets, from) ?? Promise.resolve(null),
    toc: () => book.current?.toc() ?? [],
    next: () => move(1),
    prev: () => move(-1),
    visibleRange: () => book.current?.visibleRange() ?? null,
    getSelection: () => book.current?.getSelection() ?? null,
    // C17.6: the selection as anchors (docs/ANCHORS.md), one per PDF page it touches, or one EPUB range.
    selectionAnchors: () => book.current?.selectionAnchors() ?? [],
    documents: () => book.current?.documents() ?? [],
    anchor: () => book.current?.anchor() ?? null,
  }), [move]);

  const shared = { bookId, load, wide, colours, onRelocate: relocate, onError: setFailure, ref: book, annotations }; // C21.3: drawn
  return (
    <section className="rf-ov" aria-label={label ?? title} data-wide={wide} data-kind={kind}
      data-original={theme === 'lamplight' && original ? 'true' : undefined} data-loading={(!place || opening) && !failure}
      data-start={place ? spot(placeStart(place)) : undefined} data-end={place ? spot(placeEnd(place)) : undefined}
      data-ending={ending || undefined} data-annotations={annotations ? annotations.length : undefined}
      style={{ ...(sheet ? { '--ov-sheet': `${sheet.width}px`, '--ov-sheet-h': `${sheet.height}px`, '--ov-sheet-pad': 'var(--space-4)' } : null), '--rf-leaf-paper': kind === 'pdf' ? (colours?.background ?? '#fff') : undefined }}>
      <header className="rf-ov-head" aria-hidden="true" data-empty={!place?.entry}>
        <span className="rf-ov-head-title">{title}</span>
        <span className="rf-ov-head-entry">{place?.entry ?? ''}</span>
      </header>
      <div className="rf-ov-stage" ref={stage} tabIndex={0} onKeyDown={onKey} aria-roledescription="book"
        aria-label={`${title}. Arrow keys, Page Up and Page Down, or Space turn the page.`}
        onPointerDown={(e) => swipeStart.current?.(e)} onPointerUp={(e) => swipeEnd.current?.(e)}
        onPointerCancel={() => { swipe.current = null; }}>
        <div className="rf-ov-book" data-spread={wide} ref={setBookBox}>
          {kind === 'pdf'
            ? <PdfBook key={attempt} {...shared} zoom={zoom} onSheet={setSheet} ocr={ocr} />
            : <EpubBook key={attempt} {...shared} settings={settings} onDocument={onDocument} />}
          {turn && (
            <TurnLeaf key={turn.id} turn={turn} wide={wide}
              onMiddle={() => (turn.dir > 0 ? book.current?.next() : book.current?.prev())}
              onDone={() => {
                busy.current = false;
                setTurn(null);
                const next = queued.current;
                queued.current = 0;
                if (next) setTimeout(() => moveRef.current?.(next), 0); // after the renderer has reported its new place
              }} />
          )}
          {/* The outer page edges turn the page for a pointer; keyboard users have the keys and buttons. */}
          <button type="button" className="rf-ov-edge" data-edge="back" tabIndex={-1} aria-hidden="true"
            onClick={() => move(-1)} disabled={place?.atStart} />
          <button type="button" className="rf-ov-edge" data-edge="forward" tabIndex={-1} aria-hidden="true"
            onClick={() => move(1)} disabled={ending || (place?.atEnd && !closing)} />
          {note && !noteHidden && !ending && !opening && shows(place, bounds?.start) && (
            <aside className="rf-ov-note" aria-label="Today" data-no-lookup>
              <div className="rf-note">{note}</div>
              <button type="button" className="rf-tool" onClick={() => setNoteHidden(true)} aria-label="Hide this note">
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </aside>
          )}
          {ending && <div className="rf-ov-end" data-no-lookup><div className="rf-end">{closing}</div></div>}
          {onBookmark && place && !failure && !ending && (
            <button type="button" className="rf-ov-ribbon" onClick={() => act('ribbon')} aria-label="Save my place"
              aria-keyshortcuts="B" title="Save my place (B)">
              <span className="rf-ov-ribbon-tail" aria-hidden="true" />
            </button>
          )}
        </div>
        {failure && (
          <div className="rf-ov-error" role="alert">
            <h2>This book could not be opened</h2>
            <p>{failure.message || 'The file did not load.'}</p>
            <div className="rf-ov-error-actions">
              <Button onClick={() => { setFailure(null); setAttempt((n) => n + 1); }}>Try again</Button>
              {onBack && <Button variant="secondary" onClick={onBack}>Back to the library</Button>}
            </div>
          </div>
        )}
      </div>
      <footer className="rf-ov-foot">
        <button type="button" className="rf-ov-turn" onClick={() => move(-1)} disabled={!place || (place.atStart && !ending)}>
          <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" /><span>Previous</span>
        </button>
        <p className="rf-ov-folio">{ending ? "End of today's reading"
          : place && !opening ? [place.folio, place.entry, status].filter(Boolean).join(' · ') : failure ? 'Not opened' : 'Opening the book…'}</p>
        <button type="button" className="rf-ov-turn" onClick={() => move(1)} disabled={!place || ending || (place.atEnd && !closing)}>
          <span>Next</span><ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </footer>
      {lookupClient && (
        <BookLookup ref={lookup} surfaces={surfaces} client={lookupClient} hover={hoverLookup} returnFocusTo={stage}
          paused={!place || opening || ending || Boolean(turn) || Boolean(failure)}
          page={place ? `${spot(placeStart(place))}-${spot(placeEnd(place))}` : ''} />
      )}
      {onAnnotate && (
        // C21.2: colours, underline and Ask Steve over a selection.
        <SelectionToolbar ref={toolbar} place={selected} onAnnotate={onAnnotate} onDismiss={dismissSelection} returnFocusTo={stage} />
      )}
      {kind === 'pdf' && regions && bookBox && (
        // C20.8b: equations, code and figures offer Explain, Copy code and Copy as LaTeX.
        <PdfBlockActions box={bookBox} regions={regions} bookId={bookId} pages={shownPages}
          paused={!place || opening || ending || Boolean(turn) || Boolean(failure)} />
      )}
      {kind === 'epub' && (
        // C20.8c: the same actions in an EPUB's sections; Copy as LaTeX and Copy code stay on the device.
        <EpubBlockActions sections={sections} spineOf={(doc) => book.current?.sectionIndex?.(doc) ?? null} bookId={bookId}
          paused={!place || opening || ending || Boolean(turn) || Boolean(failure)} />
      )}
      <p className="rf-ov-live" aria-live="polite" aria-atomic="true">{ending ? "End of today's reading" : opening ? '' : place?.folio ?? ''}</p>
    </section>
  );
}
