import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchApi } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Reader } from '../originalview/Reader';
import { fromOpenedBook } from '../originalview/bookFile';
import { ReaderControls } from '../originalview/ReaderControls';
import { useLamplight } from '../originalview/useLamplight';
import { createRegionSource } from '../originalview/pdf/regions';
import { createOcrSource } from '../originalview/pdf/ocr';
import { folioShort } from '../originalview/place';
import { usePlaceSaver } from '../reader/usePlaceSaver';
import { ReaderToolbar } from '../reader/ReaderToolbar';
import { useChromeVisible } from '../reader/useChromeVisible';
import { ContentsDrawer } from '../reader/ContentsDrawer';
import { useToast } from '../components/ui/toastContext';
import { createLookupClient, readLookupOn, storeLookupOn } from '../reader/lookup';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ReadingLamp } from '../illustrations';
import { StevePanel } from '../steve/StevePanel';
import { SteveContext } from '../steve/SteveContext';
import { useSteve } from '../steve/useSteve';
import { useAnnotations } from '../annotations/useAnnotations';
import { SidePanel } from '../notes/SidePanel';
import { Notepad } from '../notes/Notepad';
import { useNotes } from '../notes/useNotes';
import { chapterOf } from '../notes/place';
import { shownRange } from '../notes/sync';
import { NotesContext } from '../notes/NotesContext';
import { answerDoc, quoteDoc } from '../notes/fromBook';
import { useBodyStart } from '../focus/useBodyStart';
import { beforeBody, chosenStart, startAnchor, startLabel } from '../focus/bodyStart';
import { useFocusSession } from '../focus/useFocusSession';
import { FocusBar } from '../focus/FocusBar';
import { ReadyModal } from '../focus/ReadyModal';
import './ReadingSession.css';

// One lookup client for the app: its LRU of recent answers lasts the visit (C12.8).
const lookupClient = createLookupClient(fetchApi);

const EPUB_SETTINGS = { style: 'publisher', fontSize: 18, lineHeight: null, margins: 'normal' };

/** A per-browser reader setting, read and kept with try/catch (private windows, blocked storage). */
function useStored(key, fallback) {
  const [value, setValue] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  });
  const set = useCallback((next) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* kept for this visit only */ }
  }, [key]);
  return [value, set];
}

/**
 * The reading page (C12.5a; the original view since C17.5): the whole book as
 * published, PDF or EPUB, under a toolbar that fades while reading. C26.5: it
 * opens at the reader's last place (GET /books/{id}/open; a new book at its
 * first page), every turn is saved on the book as an anchor in the file, and
 * the closing page is the end of the book. No plan, no suggested reading; reading
 * time is measured only in focus mode (C23.7).
 */
export function ReadingSession() {
  const { bookId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState(null);
  useDocumentTitle(sessionData?.book?.title ? `${sessionData.book.title} · Reading` : 'Reading');

  const [zoom, setZoom] = useStored('rf-pdf-zoom', 'fit-page');
  const [settings, setSettings] = useStored('rf-epub-settings', EPUB_SETTINGS);
  const { user } = useAuth();
  // Hover lookup (C12.8): this user's stored choice, or what they just switched to on this visit.
  const [switched, setSwitched] = useState(null); // { userId, on }
  const hoverLookup = switched && switched.userId === user?.id ? switched.on : readLookupOn(user?.id);
  const [chapter, setChapter] = useState('');
  const [toolbarFocused, setToolbarFocused] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [annotationPages, setAnnotationPages] = useState(() => new Map());
  // The side panel (C20.7b Steve, C22.2 Notes): tabs beside the book; the book stays usable while it is open.
  const [side, setSide] = useState(null); // null | 'notes' | 'steve'
  const steveOpen = side === 'steve';
  const steveButton = useRef(null);
  const notesButton = useRef(null);
  const opener = useRef(null); // the toolbar button that opened the panel gets focus back
  const steve = useSteve(bookId, steveOpen);
  const notepad = useNotes(bookId);
  const [drawingOpen, setDrawingOpen] = useState(false); // C22.3: the panel widens while a drawing is open
  const [entries, setEntries] = useState([]);
  const [quizMeOpen, setQuizMeOpen] = useState(false); // C23.7b
  const [quizMeBusy, setQuizMeBusy] = useState(false);
  const chromeVisible = useChromeVisible(toolbarFocused || contentsOpen || quizMeOpen);
  const contentsButton = useRef(null);
  const reader = useRef(null);
  const { toast } = useToast();
  const notes = useAnnotations(bookId); // C21.2: highlights and underlines
  const kind = sessionData?.book?.format === 'epub' ? 'epub' : 'pdf';
  // C18.6d: a PDF's math, code and figure boxes, so lookup skips them (an EPUB's markup already says).
  const regions = useMemo(() => (kind === 'pdf' ? createRegionSource(fetchApi, bookId) : null), [kind, bookId]);
  const { theme, original, toggleOriginal } = useLamplight(bookId);
  // C19.4: scanned pages get a text layer read by OCR in this browser. A fully scanned book with no chunks
  // opens pages-only (no session, no test) and has every scanned page read in turn; then it is read again.
  const pagesOnly = Boolean(sessionData?.pages_only);
  // C26.3: a book opened before it is processed (GET /books/{id}/open): no session, its place saved on the book,
  // and "Preparing quizzes… n%" until its questions are made.
  const processing = Boolean(sessionData?.processing);
  const [prepared, setPrepared] = useState(null); // null while processing, else { progress } or { done: true }
  const body = useBodyStart(bookId, Boolean(sessionData) && !pagesOnly); // C23.1: where focus mode starts
  const [focusWanted, setFocusWanted] = useState(false); // C23.6: the reader's Focus mode switch
  const [leavingFocus, setLeavingFocus] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const [placingRibbon, setPlacingRibbon] = useState(false); // C23.6b: the ribbon is being set
  const [focusReady, setFocusReady] = useState(null); // C23.6b: { label } while "Ready for your questions?" is up
  const opened = Boolean(sessionData);
  const ocr = useMemo(() => (kind === 'pdf' && opened ? createOcrSource(fetchApi, bookId, {
    ahead: pagesOnly, skipFor: async (page) => { await regions?.load(page); return regions?.boxesOf(page) ?? []; },
  }) : null), [kind, opened, bookId, pagesOnly, regions]);
  const [ocrProgress, setOcrProgress] = useState(null);
  useEffect(() => {
    if (!ocr) return undefined;
    ocr.ready().then(setOcrProgress);
    return ocr.subscribe(setOcrProgress);
  }, [ocr]);
  const preparingFirst = pagesOnly && ocrProgress?.reingest;
  useEffect(() => { // once the book has been read again from its OCR text, its first session can start
    if (!preparingFirst) return undefined;
    const timer = setInterval(() => {
      fetchApi(`/books/${bookId}/status`).then((s) => {
        if (s?.status === 'ready' && s?.total_chunks > 0) window.location.reload();
      }).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [preparingFirst, bookId]);
  const quizzesDone = Boolean(prepared?.done);
  const textOnly = Boolean(sessionData?.text_only);
  useEffect(() => { // C26.7: a book read on this device has no region map: say so once as it opens
    if (textOnly) toast({ kind: 'neutral', message: 'This book was read on your device, so its equations, code and figures have no Steve or note tools.' });
  }, [textOnly, toast]);
  useEffect(() => { // C26.3: how far the quizzes are, until the book's ingestion is done; the reader stays open
    if (!processing || quizzesDone) return undefined;
    let live = true;
    const check = () => fetchApi(`/books/${bookId}/status`).then((s) => {
      if (!live) return;
      const job = s?.ingestion;
      if (job?.status === 'done' || (s?.status === 'ready' && !job)) setPrepared({ done: true });
      else if (s?.status === 'error' || job?.status === 'failed') setPrepared({ done: true }); // nothing more to wait for
      else setPrepared({ progress: typeof job?.progress === 'number' ? job.progress : null });
    }).catch(() => {});
    check();
    const timer = setInterval(check, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [processing, quizzesDone, bookId]);
  const scannedCount = ocrProgress?.scanned?.length ?? sessionData?.scanned_pages?.length ?? 0;
  const readCount = ocrProgress?.done?.length ?? 0;

  const [place, setPlace] = useState(null);
  const [standing, setStanding] = useState(false); // the book stands at its first place; moves before that are not saved
  const ready = useRef(false);
  const { save, saveNow } = usePlaceSaver(sessionData ? `/books/${bookId}/position` : null); // C26.5: every turn, on the book

  // Once the book is open: stand at the saved place (C26.5), or stay at the first page of a new book.
  const locate = useCallback(async () => {
    const book = reader.current;
    if (!book || !sessionData || ready.current) return;
    const saved = sessionData.position;
    if (saved?.anchor?.kind === kind) await book.goTo(saved.anchor);
    ready.current = true;
    setStanding(true);
  }, [sessionData, kind]);

  const focus = useFocusSession({ bookId, place, reader, wanted: focusWanted && !pagesOnly });
  const inFocus = !pagesOnly && focus.enabled;
  const onRelocate = useCallback((next) => {
    setPlace(next);
    setChapter(next.entry || '');
    if (!ready.current) return;
    const anchor = reader.current?.anchor();
    if (anchor) save({ anchor });
  }, [save]);
  const onBookmark = useCallback((anchor) => {
    if (!anchor) return;
    saveNow({ anchor });
    toast({ kind: 'neutral', message: `Place saved at ${folioShort(place?.folio) || 'this page'}.` });
  }, [saveNow, toast, place]);

  // The contents (D4): the book's own outline or nav.
  const closeContents = useCallback(() => setContentsOpen(false), []);
  const openContents = () => {
    setEntries((reader.current?.toc() ?? []).map((entry, i) => ({ ...entry, key: `${i}-${entry.title}` })));
    // C21.5: each annotation's page, read from the book as the drawer opens (the counted EPUB pages can change).
    setAnnotationPages(new Map(notes.annotations.map((a) => [a.id, reader.current?.pageLabel(a) ?? ''])));
    const anchor = body.bodyStart?.anchor; // C23.1: the start's printed page, as the folio names pages
    setStartPage(anchor ? reader.current?.pageLabel({ anchors: [anchor] }) ?? '' : '');
    setContentsOpen((open) => !open);
  };
  const onPickAnnotation = useCallback((annotation) => {
    setContentsOpen(false);
    const [anchor] = annotation.anchors;
    reader.current?.goTo(anchor.kind === 'epub' ? { cfi: anchor.cfi } : anchor);
  }, []);
  const onPick = useCallback((entry) => {
    setContentsOpen(false);
    reader.current?.goTo(entry.target);
  }, []);
  // C23.1: "The book starts here": the page or section shown becomes the body start (the reader's choice wins).
  const { choose } = body;
  const [startPage, setStartPage] = useState('');
  const startHere = useCallback(async () => {
    const chosen = chosenStart(place, chapter);
    if (!chosen) return;
    try {
      await choose(chosen);
      const shown = folioShort(place.folio);
      setStartPage(shown);
      toast({ kind: 'neutral', message: `Focus mode now starts at ${shown || 'this page'}.` });
    } catch (err) {
      toast({ kind: 'warning', message: `The start wasn't changed: ${err.message}` });
    }
  }, [place, chapter, choose, toast]);
  // C23.6: focus mode. Start at the page shown (after the body start), pause and resume, end at this page
  // (C23.6b adds the ribbon), and leaving with a session open asks: end now with the quiz, or discard it.
  const focusLocked = !focus.session && beforeBody(place, body.bodyStart);
  // C31.1: Steve beside the book in focus mode too, but never while a session waits for its quiz (FOCUS_RULES).
  const steveHere = !pagesOnly && !(inFocus && focus.session?.status === 'awaiting_quiz');
  const shownSide = side === 'steve' && !steveHere ? null : side; // a Steve panel open when the quiz came closes
  const focusDo = async (work, failed) => {
    setFocusBusy(true);
    try {
      return await work();
    } catch (err) {
      toast({ kind: 'warning', message: err.status === 422 ? failed : `That didn't work: ${err.message}` });
      return null;
    } finally {
      setFocusBusy(false);
    }
  };
  const startFocus = () => focusDo(() => focus.start((anchor) => startAnchor(anchor, body.bodyStart)), '');
  // C23.6b: End session (or the cap, or leaving): set the ribbon where the reader stopped, then the questions.
  const endFocus = () => {
    const current = focus.session;
    if (!current) return;
    if (current.status === 'awaiting_quiz' && current.bookmark_set) setFocusReady({ label: null });
    else setPlacingRibbon(true);
  };
  const setRibbon = (chosen) => focusDo(async () => {
    await focus.end(chosen.anchor);
    setPlacingRibbon(false);
    setFocusReady({ label: chosen.label });
  }, 'Set the ribbon after the page this session started on.');
  const leaveFocus = () => {
    if (focus.live) setLeavingFocus(true);
    else setFocusWanted(false);
  };
  const discardFocus = () => focusDo(async () => {
    await focus.discard();
    focus.clear();
    setLeavingFocus(false);
    setFocusWanted(false);
    toast({ kind: 'neutral', message: 'Focus session discarded. Nothing was scored.' });
  }, '');
  // C23.7b: Quiz me outside focus mode, to the end of the page(s) shown; no points.
  const quizMe = async (scope) => {
    setQuizMeBusy(true);
    try {
      const places = (await reader.current?.shownPlaces?.()) ?? [];
      const anchor = places.at(-1)?.anchor ?? reader.current?.anchor();
      const built = await fetchApi('/focus/quiz-me', { method: 'POST', body: JSON.stringify({ book_id: bookId, scope, anchor }) });
      navigate(`/quiz/${built.session_id}`);
    } catch (err) {
      setQuizMeOpen(false);
      setQuizMeBusy(false);
      toast({ kind: 'neutral', message: err.status === 409 ? err.message : `The quiz couldn't be made just now: ${err.message}` });
    }
  };
  const turnFocusOn = () => {
    setSide(null);
    setFocusWanted(true);
  };
  const closeSide = useCallback(() => setSide(null), []);
  const toggleSide = (tab, button) => {
    if (!side) opener.current = button.current;
    setSide((now) => (now === tab ? null : tab));
  };
  // A citation chip moves the book to its page or section; the panel stays open.
  const onCite = useCallback((anchor) => reader.current?.goTo(anchor?.kind === 'epub' ? { cfi: anchor.cfi } : anchor), []);
  // C22.2: a note's reference names its page and chapter, read from the book as the list draws; it goes there.
  const describeNote = (note) => ({ page: reader.current?.pageLabel(note) ?? '', chapter: chapterOf(note, reader.current?.toc() ?? []) });
  // C22.5: the book goes to the note's passage and pulses it.
  const goToNote = useCallback((note) => {
    onCite(note.anchors?.[0]);
    reader.current?.flash(note);
  }, [onCite]);
  const shown = useMemo(() => shownRange(place), [place]);
  const contentsOf = useCallback(() => reader.current?.toc() ?? [], []);
  // C22.2b: a new note (text, or C22.3 a drawing) at the selection, else the pages shown; its key, so it opens.
  const addNote = async (kind) => {
    const place = await reader.current?.notePlace();
    if (!place) {
      toast({ kind: 'warning', message: 'The book is still opening. Try again in a moment.' });
      return null;
    }
    return notepad.create({ kind, scope: place.scope, anchors: place.anchors, position_start: place.start,
      position_end: place.end, content: kind === 'drawing' ? { elements: [] } : { type: 'doc', content: [{ type: 'paragraph' }] } });
  };
  // C22.4: N or the selection toolbar's Note: a text note at the selection (read before it is cleared), else the
  // pages shown, opened in the notepad; a margin marker opens the notepad at its notes.
  const [noteRequest, setNoteRequest] = useState(null);
  const openNotes = () => setSide((now) => { if (!now) opener.current = notesButton.current; return 'notes'; });
  const newNote = async () => {
    const key = await addNote('text');
    if (!key) return;
    openNotes();
    setNoteRequest({ type: 'edit', key, n: Date.now() });
  };
  const onOpenNotes = (ids) => {
    openNotes();
    setNoteRequest({ type: 'focus', ids, n: Date.now() });
  };
  const relinkNote = async (note) => {
    const place = await reader.current?.notePlace();
    if (place?.scope !== 'selection') {
      toast({ kind: 'neutral', message: 'Select a passage in the book first, then link the note to it.' });
      return;
    }
    notepad.relink(note.id, place);
    toast({ kind: 'neutral', message: 'Note linked to the selection.' });
  };
  // C22.6: notes made from the book (block actions, a highlight's chip, a Steve answer, a dragged region): a crop
  // goes to the notes bucket first, then the note shows at once; `open` reveals it ('focus') or opens it ('edit').
  const { create: createNote, edit: editNote, uploadImage } = notepad;
  const dragged = useRef(null);
  const addFromBook = useCallback(async ({ kind, place, content, imageB64 = null, regionId = null, annotationId = null, open = 'focus' }) => {
    if (!place) {
      toast({ kind: 'warning', message: "That wasn't added to your notes. Try again." });
      return { key: null, content };
    }
    let body = content;
    let local = {};
    if (imageB64) {
      try {
        const { path, url } = await uploadImage(imageB64);
        body = { ...content, image_path: path };
        local = { urls: { [path]: url } };
      } catch {
        toast({ kind: 'warning', message: "The picture wasn't saved, so the note is added without it." });
      }
    }
    const key = createNote({ kind, scope: place.scope, anchors: place.anchors, position_start: place.start, position_end: place.end,
      content: body, ...(regionId ? { region_id: regionId } : {}), ...(annotationId ? { annotation_id: annotationId } : {}) }, local);
    if (open) {
      setSide((now) => { if (!now) opener.current = notesButton.current; return 'notes'; });
      setNoteRequest(open === 'edit' ? { type: 'edit', key, n: Date.now() } : { type: 'focus', ids: [key], n: Date.now() });
    }
    return { key, content: body };
  }, [createNote, uploadImage, toast]);
  const notesActions = useMemo(() => ({
    add: addFromBook,
    edit: editNote,
    drag: (make) => { dragged.current = make; },
    drop: () => { const make = dragged.current; dragged.current = null; make?.(); },
  }), [addFromBook, editNote]);
  const noteOnHighlight = useCallback((annotation) => addFromBook({
    kind: 'text', open: 'edit', annotationId: annotation.id, content: quoteDoc(annotation.anchors.map((a) => a.text).join(' ')),
    place: { scope: 'selection', anchors: annotation.anchors, start: annotation.position_start, end: annotation.position_end },
  }), [addFromBook]);
  const saveAnswer = useCallback(async ({ text, citations, heading }) => {
    const place = await reader.current?.notePlace(); // the passage asked about if still selected, else the pages shown
    const { key } = await addFromBook({ kind: 'text', place, content: answerDoc(text, citations, heading), open: false });
    if (key) toast({ kind: 'neutral', message: 'Saved to your notes.' });
    return key;
  }, [addFromBook, toast]);
  const { ask: askSteve } = steve;
  const steveOn = steve.state.enabled !== false; // C21.4: Ask Steve entry points hide once his settings say he is off
  const steveActions = useMemo(() => ({
    askAbout: (request) => {
      setSide((now) => { if (!now) opener.current = steveButton.current; return 'steve'; });
      askSteve(request);
    },
    enabled: steveOn,
  }), [askSteve, steveOn]);
  const onLookupToggle = () => {
    storeLookupOn(user?.id, !hoverLookup);
    setSwitched({ userId: user?.id, on: !hoverLookup });
  };

  // C26.5: the book opens at the reader's place (GET /books/{id}/open): no session, no plan, no pace check.
  useEffect(() => {
    async function openBook() {
      try {
        const opened = await fetchApi(`/books/${bookId}/open`);
        setSessionData({ ...opened, processing: opened.status === 'processing' && !opened.pages_only,
          session_id: null, chunk_indices: [], chunks: [] });
        setLoading(false);
      } catch (err) {
        toast({ kind: 'warning', message: `This book couldn't be opened: ${err.message}` });
        navigate('/');
      }
    }
    openBook();
  }, [bookId, navigate, toast]);

  // C34.3: the file's first read uses the signed URL /open already gave; renewals and retries ask /file.
  const loadFile = useMemo(() => fromOpenedBook(sessionData?.file), [sessionData?.file]);

  // The closing page at the end of the book; it mounts only when shown, so its lamp's one glow pulse lands then.
  const closing = (
    <>
      <ReadingLamp className="rf-end-lamp" />
      <h2 className="rf-end-title">That's the end of the book.</h2>
      <p className="rf-end-text">
        {pagesOnly ? 'Its quizzes are made once every page has been read.' : 'Your place is kept.'}
      </p>
    </>
  );

  const preparing = (
    <div className="rf-reading-loading" role="status">
      <span className="rf-reading-loading-text">Opening your book…</span>
    </div>
  );

  if (loading) return preparing;

  const bookTitle = sessionData.book?.title || 'Your book';

  return (
    <div className="rf-reading-page" data-focus={inFocus}>
      <div className="rf-reading-chrome">
        {inFocus ? (
          <FocusBar session={focus.session} readAt={focus.readAt} locked={focusLocked}
            startLabel={startLabel(body.bodyStart)} idle={focus.idle} idleLapsed={focus.idleLapsed} busy={focusBusy}
            onStart={startFocus} onPause={() => focusDo(focus.pause, '')} onResume={() => focusDo(focus.resume, '')}
            onEnd={endFocus} onLeave={focus.readOnly ? () => navigate('/') : leaveFocus} onAnswerIdle={focus.answerIdle}
            placing={placingRibbon} readOnly={focus.readOnly}
            onNotes={() => toggleSide('notes', notesButton)} notesOpen={side === 'notes'} notesRef={notesButton}
            notesCount={notepad.notes.length} onSteve={steveHere ? () => toggleSide('steve', steveButton) : undefined}
            steveOpen={steveOpen} steveRef={steveButton} />
        ) : (
        <ReaderToolbar
          bookTitle={bookTitle}
          chapter={chapter}
          onBack={() => navigate('/')}
          visible={chromeVisible}
          onFocusChange={setToolbarFocused}
          controls={(
            <ReaderControls kind={kind} zoom={zoom} onZoom={setZoom} settings={settings} onSettings={setSettings}
              lamplight={theme === 'lamplight'} original={original} onOriginal={toggleOriginal} />
          )}
          onContents={openContents}
          contentsOpen={contentsOpen}
          contentsRef={contentsButton}
          lookupOn={hoverLookup}
          onLookupToggle={onLookupToggle}
          onNotes={() => toggleSide('notes', notesButton)}
          notesOpen={side === 'notes'}
          notesRef={notesButton}
          notesCount={notepad.notes.length}
          onSteve={pagesOnly ? undefined : () => toggleSide('steve', steveButton)}
          steveOpen={steveOpen}
          steveRef={steveButton}
          onFocusMode={pagesOnly ? undefined : turnFocusOn}
        >
          {!pagesOnly && (
            <button type="button" className="rf-tool" onClick={() => setQuizMeOpen(true)}>
              <span>Quiz me</span>
            </button>
          )}
          {processing && !quizzesDone ? (
            <div className="rf-toolbar-group rf-toolbar-session" role="group" aria-label="Quizzes">
              <span className="rf-session-time" role="status">
                {prepared?.progress != null ? `Preparing quizzes… ${Math.round(prepared.progress * 100)}%` : 'Preparing quizzes…'}
              </span>
            </div>
          ) : null}
          {pagesOnly ? (
            <div className="rf-toolbar-group rf-toolbar-session" role="group" aria-label="Pages read">
              <span className="rf-session-time" role="status">
                {preparingFirst ? 'Preparing quizzes…' : `Reading this scan: ${readCount} of ${scannedCount} pages`}
              </span>
            </div>
          ) : null}
        </ReaderToolbar>
        )}
      </div>

      <SteveContext.Provider value={steveHere ? steveActions : null}>
      <NotesContext.Provider value={notesActions}>
      <div className="rf-reading-body">
      <main className="rf-reading-area">
        {/* C13.9: the page's one h1 for assistive tech; the book's own headings are the publisher's. */}
        <h1 className="sr-only">{bookTitle}</h1>
        <Reader
          ref={reader}
          kind={kind}
          bookId={bookId}
          load={loadFile}
          title={bookTitle}
          zoom={zoom}
          settings={settings}
          onReady={locate}
          onRelocate={onRelocate}
          onBookmark={onBookmark}
          onBack={() => navigate('/')}
          opening={!standing}
          placing={placingRibbon && inFocus ? { onSet: setRibbon, onCancel: () => setPlacingRibbon(false) } : null}
          closing={closing}
          status={beforeBody(place, body.bodyStart) ? `Focus mode starts at ${startLabel(body.bodyStart)}` : null}
          label={bookTitle}
          lookupClient={lookupClient}
          hoverLookup={hoverLookup}
          regions={regions}
          ocr={ocr}
          onAnnotate={notes.create}
          annotations={notes.annotations}
          onAnnotationChange={notes.update}
          onAnnotationDelete={notes.remove}
          notes={notepad.state === 'ready' ? notepad.notes.filter((n) => !n.pending) : null}
          onNewNote={newNote}
          onOpenNotes={onOpenNotes}
          onAnnotationNote={noteOnHighlight}
          contents={sessionData.book?.toc}
          start={sessionData.position?.anchor}
        />
      </main>
      {shownSide && (
        <SidePanel
          tabs={[
            { id: 'notes', label: 'Notes', count: notepad.notes.length },
            ...(!steveHere ? [] : [{ id: 'steve', label: 'Steve', mark: <span className="rf-steve-av rf-steve-av--sm" aria-hidden="true">S</span> }]),
          ]}
          current={shownSide}
          onTab={setSide}
          onClose={closeSide}
          returnTo={opener}
          wide={side === 'notes' && drawingOpen}
        >
          {shownSide === 'steve' ? (
            <StevePanel steve={steve} chapter={chapter} onCite={onCite} onClose={closeSide} onSaveNote={saveAnswer} />
          ) : (
            <Notepad notes={notepad.notes} state={notepad.state} statuses={notepad.statuses} describe={describeNote}
              onGoTo={goToNote} onRemove={notepad.remove} onReload={notepad.reload} onRetry={notepad.flush}
              onKeepMine={notepad.keepMine} onTakeTheirs={notepad.takeTheirs} onChange={notepad.edit} onAdd={addNote} onThumbnail={notepad.attachThumbnail} onDrawing={setDrawingOpen}
              onRelink={relinkNote} request={noteRequest} range={shown} contents={contentsOf} />
          )}
        </SidePanel>
      )}
      </div>
      </NotesContext.Provider>
      </SteveContext.Provider>

      <ContentsDrawer
        open={contentsOpen}
        onClose={closeContents}
        entries={entries}
        current={chapter}
        onPick={onPick}
        returnTo={contentsButton}
        annotations={pagesOnly ? null : notes.annotations}
        pageOf={(a) => annotationPages.get(a.id) ?? ''}
        onPickAnnotation={onPickAnnotation}
        bodyStart={body.bodyStart}
        startPage={startPage}
        onStartHere={pagesOnly ? null : startHere}
      />

      <ReadyModal open={Boolean(focusReady)} sessionId={focus.session?.id} label={focusReady?.label}
        points={focus.session?.points_time ?? 0} onLater={() => setFocusReady(null)}
        onStart={() => navigate(`/focus/${focus.session.id}/quiz`)} />

      <Modal isOpen={quizMeOpen} onClose={() => setQuizMeOpen(false)} title="Quiz me">
        <p className="rf-leave-text">A few questions on what you’ve read. No points, and your answers still update what you’ve mastered.</p>
        <div className="rf-leave-actions rf-leave-actions--stack">
          <Button onClick={() => quizMe('chapter')} disabled={quizMeBusy}>This chapter</Button>
          <Button variant="secondary" onClick={() => quizMe('since_last')} disabled={quizMeBusy}>Since my last quiz</Button>
        </div>
      </Modal>

      <Modal isOpen={leavingFocus} onClose={() => setLeavingFocus(false)} title="Leave focus mode?">
        <p className="rf-leave-text">End the session now and answer a few questions to keep its points, or discard it and
          nothing is scored. Your place in the book is kept either way.</p>
        <div className="rf-leave-actions rf-leave-actions--stack">
          <Button onClick={() => { setLeavingFocus(false); endFocus(); }} disabled={focusBusy}>End and take the quiz</Button>
          <Button variant="secondary" onClick={() => setLeavingFocus(false)}>Keep focusing</Button>
          <Button variant="secondary" onClick={discardFocus} disabled={focusBusy}>Discard session</Button>
        </div>
      </Modal>

    </div>
  );
}
