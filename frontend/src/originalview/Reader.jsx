import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from '../motion/presets';
import { Button } from '../components/ui/Button';
import { BookLookup } from './BookLookup';
import { SelectionToolbar } from '../annotations/SelectionToolbar';
import { useSelection } from '../annotations/useSelection';
import { newAnnotation } from '../annotations/palette';
import { AnnotationChip } from '../annotations/AnnotationChip';
import { useAnnotationChip } from '../annotations/useAnnotationChip';
import { cycle } from '../annotations/hover';
import { PdfBlockActions } from '../steve/PdfBlockActions';
import { EpubBlockActions } from '../steve/EpubBlockActions';
import { MarginMarkers } from '../notes/MarginMarkers';
import { RibbonPlacer } from '../focus/RibbonPlacer';
import { PlaceMark } from './PlaceMark';
import { EpubBook } from './epub/EpubBook';
import { FindBar } from './FindBar';
import { useFind } from './useFind';
import { startPage } from './pdf/contents';
import { PdfBook } from './pdf/PdfBook';
import { skipPdfPoint } from './pdf/regions';
import { keyAction, readerShortcut, SPREAD_MIN_WIDTH } from './frame';
import { placeEnd, placeStart } from './place';

/** "5" for a PDF page, "2:340" for an EPUB section and character: the place's ends, for tests and tools. */
const spot = (loc) => (loc.kind === 'pdf' ? String(loc.page) : `${loc.index}:${loc.char}`);
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
 * A book shown as published, PDF or EPUB, in one frame (C17.4): a spread from
 * 1024 px and one page below, the running header (title, contents entry) and the
 * ribbon outside the page, a folio under it, page turns by keys, edge clicks and
 * swipes (C38.3: the book as published in either theme). `ref` gets
 * { goTo(anchor), next(), prev(), visibleRange(), getSelection(), documents() }.
 * onRelocate(place) on every move; onBookmark(anchor) from the ribbon or B.
 *
 * Past the book's last page (Next, Space, End) the `closing` page covers the book and Previous
 * comes back (C26.5: the end of the book; today's reading is gone); Home goes to the first page.
 * `opening` keeps the blank page up while the reader opens its place; `status` joins the folio
 * ("Focus mode starts at …"). `ref` also gets find(snippets, from) and toc().
 * C34.2: a PDF opens at `start` (the saved place's anchor) and takes its outline from
 * `contents` (the stored books.toc) when that has pages.
 * C38.2 (issue 22): a PDF scrolls, as in Edge (PdfBook): no running header, leaf, edge zones or closing page over
 * it; Previous, Next and the page keys move a page at a time, Up and Down scroll a little, and the closing words sit
 * below its last page. C38.7a: an EPUB scrolls too (EpubBook, foliate's scrolled flow): the running header, the leaf,
 * the edge zones, its footer and the closing page over it are gone, and its closing words are a card at the bottom
 * once its end is scrolled to. C38.4a: `pageView` is a PDF's Page view (PdfBook).
 * C38.4c: a PDF has no footer: the toolbar's page box names the page, `status` is a quiet note on the desk, and the
 * live region still says the page or the end.
 * C38.8b: no ribbon over the desk: the toolbar's Save my place (`saveMark()` on the ref) and B save the place, and
 * `mark` (the anchor saved) is a small ribbon beside it (PlaceMark).
 * C38.5: the find bar (FindBar, useFind): Ctrl+F (or `openFind()` on the ref, the toolbar's Find) opens it with
 * the query selected, F3 and Shift+F3 step through the matches while it is open, and Escape in it closes it, focus
 * back on the book. Not in a dialog over the book (the notebook has its own). C38.5c: an EPUB's too, its keys heard
 * inside its sections. C38.9: Ctrl+G and Ctrl+Shift+G step through the matches (or open the bar), as Edge's; the other
 * shortcuts pressed inside an EPUB's section (Ctrl+Alt+G, Ctrl+\, Ctrl+= and Ctrl+-) reach the page.
 * With a `lookupClient`, words are looked up in place in both renderers (BookLookup;
 * `hoverLookup` false leaves selection, long-press and Enter). `regions` (pdf/regions.js, C18.6d)
 * keeps a PDF's math, code, figures and tables out of lookup, as the EPUB's markup already does.
 */
export function Reader({
  kind, bookId, load, title, zoom = 'fit-page', settings = { style: 'publisher', fontSize: 18, lineHeight: null, margins: 'normal' },
  onRelocate, onBookmark, onReady, onBack, label, ref, closing = null, opening = false, status = null, lookupClient = null, hoverLookup = true, regions = null, ocr = null, onAnnotate = null, markup = null, marks = null, onStroke = null, eraser = null, annotations = null,
  onAnnotationChange = null, onAnnotationDelete = null, notes = null, onNewNote = null, onOpenNotes = null, onAnnotationNote = null,
  placing = null, contents = null, start = null, pageView = 'one', mark = null,
}) {
  const wide = useWide();
  const book = useRef(null);
  const [place, setPlace] = useState(null);
  const [failure, setFailure] = useState(null);
  const [attempt, setAttempt] = useState(0); // Try again remounts the renderer
  const swipe = useRef(null);
  const stage = useRef(null);
  const [pulse, setPulse] = useState(null); // C22.5: { id, rects, whole } a note's passage, pulsed after a jump
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
  const finder = useFind(book); // C38.5
  const { openFind, close: closeFind } = finder;
  const finding = finder.open;
  const findNext = finder.next;
  const findPrev = finder.prev;
  const findKeyRef = useRef(null);
  useEffect(() => {
    const onFindKey = (event) => {
      if (event.defaultPrevented || event.target?.closest?.('[role="dialog"]')) return;
      const shortcut = readerShortcut(event);
      if (shortcut === 'find') {
        event.preventDefault();
        openFind();
      } else if (shortcut === 'find-next' || shortcut === 'find-prev') { // C38.9: Ctrl+G, Ctrl+Shift+G
        event.preventDefault();
        if (!finding) openFind();
        else if (shortcut === 'find-prev') findPrev();
        else findNext();
      } else if (finding && event.key === 'F3' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        if (event.shiftKey) findPrev();
        else findNext();
      }
    };
    findKeyRef.current = onFindKey;
    document.addEventListener('keydown', onFindKey);
    return () => document.removeEventListener('keydown', onFindKey);
  }, [openFind, finding, findNext, findPrev]);
  useEffect(() => { // C18.6d: the boxes of the pages shown are asked for before a word is hovered
    if (regions && shownPages) shownPages.split(',').forEach((n) => regions.load(Number(n)));
  }, [regions, shownPages]);

  const relocate = useCallback((next) => {
    setPlace(next);
    onRelocate?.(next);
  }, [onRelocate]);
  useEffect(() => { if (place) onReady?.(); }, [Boolean(place)]); // eslint-disable-line react-hooks/exhaustive-deps -- first place only

  const { place: selected, dismiss: dismissSelection } = useSelection({
    book, docs: selectionDocs, skipAt, paused: !onAnnotate || !place || opening || Boolean(failure),
  });
  // C39.3 (issue 23): with Edge's highlighter on (`markup`), a settled selection is highlighted at once in its colour,
  // and cleared, so the next drag starts fresh; no selection toolbar.
  const highlighting = markup?.tool === 'highlight';
  useEffect(() => {
    if (!highlighting || !selected) return;
    onAnnotate(newAnnotation(selected, markup.colour, 'highlight'));
    selected.doc.getSelection()?.removeAllRanges();
    dismissSelection(false);
  }, [highlighting, selected]); // eslint-disable-line react-hooks/exhaustive-deps -- once per settled selection

  // C21.4: with word lookup off, a drawn annotation's chip on hover, a tap or A (Ask Steve, colour, underline, delete).
  const chipEl = useRef(null);
  const entries = useCallback(() => book.current?.annotationEntries?.() ?? [], []);
  const rectsOf = useCallback((id) => entries().find((e) => e.id === id)?.rects ?? [], [entries]);
  const chipActive = Boolean(onAnnotate) && !hoverLookup && Boolean(place) && !opening && !failure;
  const { open: chipOpen, show: showChip, close: closeChip } = useAnnotationChip({
    entries, chip: chipEl, active: chipActive, blocked: Boolean(selected),
  });
  const chipFor = chipOpen && annotations?.find((a) => a.id === chipOpen.id);
  /** The next (dir 1) or previous (-1) annotation drawn on the pages shown, in reading order, by key. */
  const cycleChip = useCallback((dir) => {
    const view = stage.current?.getBoundingClientRect();
    if (!view) return false;
    const order = new Map((annotations ?? []).map((a, i) => [a.id, a.position_start ?? i]));
    const ids = entries()
      .filter((e) => e.rects.some((r) => r.bottom > view.top && r.top < view.bottom && r.right > view.left && r.left < view.right))
      .sort((a, b) => order.get(a.id) - order.get(b.id)).map((e) => e.id);
    const id = cycle(ids, chipOpen?.id ?? null, dir);
    if (id) showChip({ id, by: 'key' });
    return Boolean(id);
  }, [annotations, entries, chipOpen, showChip]);
  const closeChipTo = (book) => {
    closeChip();
    if (book) stage.current?.focus();
  };

  const move = useCallback(async (dir) => { // C38.7a: both renderers scroll (a fixed-layout EPUB turns), no leaf
    const renderer = book.current;
    if (!renderer) return false;
    return dir > 0 ? renderer.next() : renderer.prev();
  }, []);

  const act = useCallback((action) => {
    const renderer = book.current;
    if (!renderer) return;
    if (action === 'next') move(1);
    else if (action === 'prev') move(-1);
    else if (action === 'first') renderer.first();
    else if (action === 'last') renderer.last();
    else if (action === 'ribbon' && onBookmark) onBookmark(renderer.anchor());
  }, [move, onBookmark]);

  const onKey = useCallback((event) => {
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (event.shiftKey && EXTEND[event.key] && !event.altKey && !event.metaKey && extendSelection(book.current?.getSelection(), event)) {
      event.preventDefault();
      return;
    }
    if (onAnnotate && toolbar.current?.onKey(event)) return;
    if (onNewNote && (event.key === 'n' || event.key === 'N') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); // C22.4: a new note at the selection, else the pages shown
      onNewNote();
      return;
    }
    if (chipActive && !selected && (event.key === 'a' || event.key === 'A') && !event.ctrlKey && !event.metaKey && !event.altKey
      && cycleChip(event.shiftKey ? -1 : 1)) {
      event.preventDefault();
      return;
    }
    if (lookupClient && (event.key === 'Enter' || event.key === '?') && lookup.current?.lookUpSelection()) {
      event.preventDefault(); // the card opens with focus
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); // C38.2: a little scroll, as in Edge (C38.7a: an EPUB too)
      const by = event.key === 'ArrowDown' ? 48 : -48;
      if (kind === 'pdf') bookBox?.querySelector('.rf-pdf-book')?.scrollBy({ top: by });
      else book.current?.scrollBy?.(by);
      return;
    }
    if (event.key === 'Escape') {
      lookup.current?.clear();
      dismissSelection();
      closeChip();
    }
    const action = keyAction(event);
    if (!action || (action === 'ribbon' && !onBookmark)) return;
    event.preventDefault();
    act(action);
  }, [act, onBookmark, lookupClient, onAnnotate, dismissSelection, chipActive, selected, cycleChip, closeChip, onNewNote, kind, bookBox]);

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
    doc.addEventListener('keydown', (e) => {
      findKeyRef.current?.(e);
      if (!e.defaultPrevented && readerShortcut(e)) { // C38.9: the page's shortcuts, pressed in the section
        e.preventDefault();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
          shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true, cancelable: true }));
        return;
      }
      if (!e.defaultPrevented) onKeyRef.current?.(e);
    });
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
    doc.addEventListener('pointerup', relay); // C21.4: a tap on a highlight
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    setSections((list) => [...list.filter((d) => d.defaultView && d !== doc), doc]);
    doc.addEventListener('pointerup', (e) => swipeEnd.current?.(e));
  }, []);

  // C22.5: pulse a note's passage once the book shows it: asked again every 100 ms (pages draw and sections lay
  // out after the move) for up to 2 s; rects in the book box's coordinates, only those inside it.
  const pulseTimer = useRef(null);
  useEffect(() => () => clearTimeout(pulseTimer.current), []);
  const flash = useCallback((note) => {
    let tries = 20;
    const attempt = () => {
      clearTimeout(pulseTimer.current);
      const within = bookBox?.getBoundingClientRect();
      const rects = within ? (book.current?.passageRects?.(note) ?? [])
        .filter((r) => r.top + r.height > within.top && r.top < within.bottom && r.left + r.width > within.left && r.left < within.right)
        .map((r) => ({ left: r.left - within.left, top: r.top - within.top, width: r.width, height: r.height })) : [];
      if (!rects.length) {
        tries -= 1;
        if (tries > 0) pulseTimer.current = setTimeout(attempt, 100);
        return;
      }
      setPulse({ id: Date.now(), rects: rects.slice(0, 60), whole: note.scope === 'view' });
      pulseTimer.current = setTimeout(() => setPulse(null), prefersReducedMotion() ? 900 : 1700);
    };
    attempt();
  }, [bookBox]);

  // C23.6b: the pages shown as places for focus mode's ribbon: [{ anchor, label }] (an EPUB's label is its folio).
  const folio = place?.folio;
  const shownPlaces = useCallback(async () => (await (book.current?.shownPlaces?.() ?? [])).map((p) => ({
    ...p, label: p.label ?? (folio ? folio.split(' of ')[0] : 'this page') })), [folio]);
  useImperativeHandle(ref, () => ({
    goTo: (anchor) => book.current?.goTo(anchor),
    find: (snippets, from) => book.current?.find(snippets, from) ?? Promise.resolve(null),
    toc: () => book.current?.toc() ?? [],
    next: () => move(1),
    prev: () => move(-1),
    visibleRange: () => book.current?.visibleRange() ?? null,
    getSelection: () => book.current?.getSelection() ?? null,
    // C17.6: the selection as anchors (docs/ANCHORS.md), one per PDF page it touches, or one EPUB range.
    selectionAnchors: () => book.current?.selectionAnchors() ?? [],
    pageLabel: (annotation) => book.current?.pageLabel?.(annotation) ?? '', // C21.5: the Annotations tab
    documents: () => book.current?.documents() ?? [],
    anchor: () => book.current?.anchor() ?? null,
    // C22.2b: { scope, anchors, start, end } for a new note: the selection, else the pages shown.
    notePlace: () => book.current?.notePlace?.() ?? Promise.resolve(null),
    shownPlaces, // C23.6b
    flash, // C22.5
    openFind, // C38.5
    saveMark: () => act('ribbon'), // C38.8b: the toolbar's Save my place
    thumbnail: (n, width) => book.current?.thumbnail?.(n, width) ?? Promise.resolve(null), // C38.6b: a PDF's Pages tab
    pageLabelOf: (n) => book.current?.pageLabelOf?.(n) ?? String(n),
  }), [move, flash, shownPlaces, openFind, act]);

  const shared = { bookId, load, wide, onRelocate: relocate, onError: setFailure, ref: book, annotations }; // C21.3: drawn
  const atClose = Boolean(closing && place?.atEnd); // C38.2: the end is scrolled to (C38.7a: an EPUB's too)
  return (
    <section className="rf-ov" aria-label={label ?? title} data-wide={wide} data-kind={kind}
      data-loading={(!place || opening) && !failure}
      data-start={place ? spot(placeStart(place)) : undefined} data-end={place ? spot(placeEnd(place)) : undefined}
      data-ending={atClose || undefined} data-annotations={annotations ? annotations.length : undefined}
      data-finding={finding || undefined} data-tool={markup?.tool}
      >
      <div className="rf-ov-stage" ref={stage} tabIndex={0} onKeyDown={onKey} aria-roledescription="book"
        aria-label={kind === 'pdf' ? `${title}. Scroll, or use Page Up and Page Down to move a page at a time.`
          : `${title}. Scroll, or use Page Up and Page Down to move a screen at a time.`}
        onPointerDown={(e) => swipeStart.current?.(e)} onPointerUp={(e) => swipeEnd.current?.(e)}
        onPointerCancel={() => { swipe.current = null; }}>
        <div className="rf-ov-book" ref={setBookBox}>
          {kind === 'pdf'
            ? <PdfBook key={attempt} {...shared} zoom={zoom} view={pageView} ocr={ocr} contents={contents} startPage={startPage(start)}
              marks={marks} ink={markup?.tool === 'draw' && onStroke ? { ...markup.ink, onStroke } : null}
              eraser={eraser && ['draw', 'erase'].includes(markup?.tool) ? { ...eraser, on: markup.tool === 'erase' } : null}
              end={closing && <div className="rf-end">{closing}</div>} found={finding ? finder.found : null} />
            : <EpubBook key={attempt} {...shared} settings={settings} onDocument={onDocument} found={finding ? finder.found : null} />}
          {pulse && (
            <div key={pulse.id} className="rf-passage-pulses" data-whole={pulse.whole || undefined} aria-hidden="true">
              {pulse.rects.map((r, i) => (
                <span key={i} className="rf-passage-pulse" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
              ))}
            </div>
          )}
          {notes && onOpenNotes && (
            // C22.4: a count circle in the margin beside each passage with notes; it opens them.
            <MarginMarkers book={book} box={bookBox} notes={notes} wide={wide} onOpen={onOpenNotes}
              layout={`${zoom}|${settings.fontSize}|${settings.lineHeight}|${settings.margins}|${settings.style}|${place?.kind === 'pdf' ? shownPages : place?.cfi}`}
              hidden={!place || opening || Boolean(failure)} />
          )}
          {placing && place && !failure && (
            <RibbonPlacer load={shownPlaces} placeKey={`${place.start ?? ''}|${place.pages ?? ''}|${place.cfi ?? ''}`}
              onSet={placing.onSet} onCancel={placing.onCancel} />
          )}
          <PlaceMark book={book} box={bookBox} mark={mark} hidden={!place || opening || Boolean(failure) || Boolean(placing)}
            layout={`${zoom}|${pageView}|${settings.fontSize}|${settings.lineHeight}|${settings.margins}|${settings.style}|${place?.kind === 'pdf' ? shownPages : place?.cfi}`} />
        </div>
        {status && !opening && <p className="rf-ov-status">{status}</p>}
        {kind !== 'pdf' && atClose && <div className="rf-epub-end" data-no-lookup><div className="rf-end">{closing}</div></div>}
        {finding && place && !failure && (
          <FindBar finder={{ ...finder, close: () => { closeFind(); stage.current?.focus(); } }} />
        )}
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
      {lookupClient && (
        <BookLookup ref={lookup} surfaces={surfaces} client={lookupClient} hover={hoverLookup} returnFocusTo={stage}
          paused={!place || opening || Boolean(failure)}
          page={place ? `${spot(placeStart(place))}-${spot(placeEnd(place))}` : ''} />
      )}
      {onAnnotate && (
        // C21.2: colours, underline and Ask Steve over a selection.
        <SelectionToolbar ref={toolbar} place={highlighting ? null : selected} onAnnotate={onAnnotate} onNote={onNewNote} onDismiss={dismissSelection} returnFocusTo={stage} />
      )}
      {chipFor && (
        <AnnotationChip ref={chipEl} annotation={chipFor} by={chipOpen.by} rectsOf={rectsOf} onCycle={cycleChip}
          onChange={onAnnotationChange} onDelete={onAnnotationDelete} onClose={closeChipTo} onNote={onAnnotationNote} />
      )}
      {kind === 'pdf' && regions && bookBox && (
        // C20.8b: equations, code and figures offer Explain, Copy code and Copy as LaTeX.
        <PdfBlockActions box={bookBox} regions={regions} bookId={bookId} pages={shownPages}
          paused={!place || opening || Boolean(failure)} />
      )}
      {kind === 'epub' && (
        // C20.8c: the same actions in an EPUB's sections; Copy as LaTeX and Copy code stay on the device.
        <EpubBlockActions sections={sections} spineOf={(doc) => book.current?.sectionIndex?.(doc) ?? null} bookId={bookId}
          placeOf={(doc, el, text) => book.current?.elementPlace?.(doc, el, text) ?? null}
          paused={!place || opening || Boolean(failure)} />
      )}
      <p className="rf-ov-live" aria-live="polite" aria-atomic="true">{atClose ? 'End of the book' : opening ? '' : place?.folio ?? ''}</p>
    </section>
  );
}
