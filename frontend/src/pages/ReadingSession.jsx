import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pause, Play, X } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { CalibrationFlow } from '../components/CalibrationFlow';
import { Reader } from '../originalview/Reader';
import { ReaderControls } from '../originalview/ReaderControls';
import { useLamplight } from '../originalview/useLamplight';
import { createRegionSource } from '../originalview/pdf/regions';
import { createOcrSource } from '../originalview/pdf/ocr';
import { beyond, chunkAt, compare, folioShort, snippetsFor } from '../originalview/today';
import { usePlaceSaver } from '../reader/usePlaceSaver';
import { createReadAhead } from '../reader/readAhead';
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
import { beforeBody, chosenStart, startLabel } from '../focus/bodyStart';
import { useFocusSession } from '../focus/useFocusSession';
import { FocusBar } from '../focus/FocusBar';
import './ReadingSession.css';

// One read-ahead cache for the app: the chunk after today's reading, whose text marks where today ends (C17.5).
const readAhead = createReadAhead(fetchApi);
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

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

/**
 * The reading page (C12.5a; the original view since C17.5): the whole book as
 * published, PDF or EPUB, opened at today's reading under a toolbar that fades
 * while reading. Today's chunks are found in the book by their text; the
 * planner's reason lies over the first page of them, and past their end the
 * closing page says "That's today's reading" with Start test. The place is
 * saved as an anchor in the file while inside today's reading. Calibration, the
 * countdown (Start, Pause, Resume, auto-pause at zero), Done reading and the
 * abandon modal behave as before.
 */
export function ReadingSession() {
  const { bookId } = useParams();
  const navigate = useNavigate();

  const [profileChecked, setProfileChecked] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState(null);
  useDocumentTitle(sessionData?.book?.title ? `${sessionData.book.title} · Reading` : 'Reading');

  // Timer state, as before
  const [timeLeft, setTimeLeft] = useState(0); // in seconds
  const [timerStatus, setTimerStatus] = useState('idle'); // 'idle' | 'running' | 'paused'

  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
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
  const chromeVisible = useChromeVisible(toolbarFocused || showAbandonModal || contentsOpen);
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
  const body = useBodyStart(bookId, Boolean(sessionData) && !pagesOnly); // C23.1: where focus mode starts
  const [focusWanted, setFocusWanted] = useState(false); // C23.6: the reader's Focus mode switch
  const [leavingFocus, setLeavingFocus] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
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
  const scannedCount = ocrProgress?.scanned?.length ?? sessionData?.scanned_pages?.length ?? 0;
  const readCount = ocrProgress?.done?.length ?? 0;

  // Today's reading in the book (C17.5): where its chunks start and where the next chunk begins.
  const [bounds, setBounds] = useState(null); // { start, end, starts: [{ chunk_index, loc }] }
  const [place, setPlace] = useState(null);
  const ready = useRef(null); // the bounds once the reader stands at its first place; moves before that are not saved
  const todayAnchor = useRef(null); // the last place inside today's reading, to come back to
  const { save, saveNow } = usePlaceSaver(sessionData?.session_id);
  const todayChunks = useMemo(() => new Set(sessionData?.chunk_indices ?? []), [sessionData]);
  const lastChunk = sessionData?.chunk_indices?.length ? Math.max(...sessionData.chunk_indices) : null;

  // Once the book is open: find today's chunks and the next one, then stand at the saved place or today's start.
  const locate = useCallback(async () => {
    const book = reader.current;
    if (!book || !sessionData || ready.current) return;
    const saved = sessionData.position;
    const resume = saved?.anchor?.kind === kind && todayChunks.has(saved.chunk_index) ? saved.anchor : null;
    let from = resume?.page ?? 1;
    const starts = [];
    for (const chunk of [...(sessionData.chunks ?? [])].sort((a, b) => a.chunk_index - b.chunk_index)) {
      const loc = await book.find(snippetsFor(chunk.content), from);
      if (loc) starts.push({ chunk_index: chunk.chunk_index, loc });
      if (loc?.page) from = loc.page;
    }
    const start = starts[0]?.loc ?? null;
    const next = lastChunk === null ? null : await readAhead.load(bookId, lastChunk + 1);
    let end = next ? await book.find(snippetsFor(next.content), from) : null;
    if (end && start && compare(end, start) < 0) end = null; // the next chunk's text found earlier: no end
    if (resume ?? start) await book.goTo(resume ?? start);
    const found = { start, end, starts };
    ready.current = found;
    setBounds(found);
  }, [sessionData, kind, todayChunks, lastChunk, bookId]);

  const outside = beyond(place, bounds ?? {});
  const focus = useFocusSession({ bookId, place, reader, wanted: focusWanted && !pagesOnly });
  const inFocus = !pagesOnly && focus.enabled;
  const placeFor = useCallback((at, anchor) => ({
    chunk_index: chunkAt(at, ready.current?.starts) ?? sessionData.chunk_indices[0], anchor,
  }), [sessionData]);
  const onRelocate = useCallback((next) => {
    setPlace(next);
    setChapter(next.entry || '');
    if (!ready.current || beyond(next, ready.current)) return; // only today's reading is saved
    const anchor = reader.current?.anchor();
    if (!anchor) return;
    todayAnchor.current = anchor;
    save(placeFor(next, anchor));
  }, [save, placeFor]);
  const onBookmark = useCallback((anchor) => {
    if (!anchor) return;
    saveNow(placeFor(place, anchor));
    if (!beyond(place, ready.current ?? {})) todayAnchor.current = anchor;
    toast({ kind: 'neutral', message: `Place saved at ${folioShort(place?.folio) || 'this page'}.` });
  }, [saveNow, placeFor, toast, place]);

  // The contents (D4): the book's own outline or nav, today's entries labelled.
  const closeContents = useCallback(() => setContentsOpen(false), []);
  const openContents = () => {
    const today = (loc) => Boolean(bounds?.start && compare(loc, bounds.start) >= 0 && (!bounds.end || compare(loc, bounds.end) <= 0));
    setEntries((reader.current?.toc() ?? []).map((entry, i) => ({ ...entry, key: `${i}-${entry.title}`, today: today(entry.loc) })));
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
  const startFocus = () => focusDo(focus.start, '');
  const endFocus = () => focusDo(async () => {
    if (focus.session?.status === 'awaiting_quiz' && !focus.session.capped) return null; // C23.6b: the questions
    const view = await focus.end(reader.current?.anchor());
    toast({ kind: 'neutral', message: `Bookmark set at ${folioShort(place?.folio) || 'this page'}. Your questions come next.` });
    return view;
  }, 'Place the bookmark after where this session started.');
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
  const turnFocusOn = () => {
    setSide(null);
    setFocusWanted(true);
  };
  const backToToday = () => reader.current?.goTo(todayAnchor.current ?? bounds?.start);
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

  // 1. Check profile calibration
  useEffect(() => {
    async function checkProfile() {
      try {
        const profile = await fetchApi('/auth/profile');
        if (!profile.is_calibrated) setIsCalibrated(false);
        setProfileChecked(true);
      } catch (err) {
        console.error('Failed to check profile', err);
        // Fallback to calibrated to prevent blocking the user on error
        setIsCalibrated(true);
        setProfileChecked(true);
      }
    }
    checkProfile();
  }, []);

  // 2. Start the session (only after calibration is confirmed)
  useEffect(() => {
    if (!profileChecked || !isCalibrated) return;
    async function startSession() {
      try {
        const data = await fetchApi('/sessions/start', { method: 'POST', body: JSON.stringify({ book_id: bookId }) });
        setSessionData(data);
        setTimeLeft(data.focus_duration_minutes * 60);
        setLoading(false);
      } catch (err) {
        toast({ kind: 'warning', message: `Today's reading couldn't be prepared: ${err.message}` });
        navigate('/');
      }
    }
    startSession();
  }, [bookId, navigate, profileChecked, isCalibrated, toast]);

  // Timer loop, as before
  useEffect(() => {
    let interval = null;
    if (timerStatus === 'running' && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    } else if (timeLeft === 0 && timerStatus === 'running') {
      setTimerStatus('paused'); // Auto-pause at 0
    }
    return () => clearInterval(interval);
  }, [timerStatus, timeLeft]);

  const totalSeconds = sessionData?.focus_duration_minutes * 60 || 1;

  const handleFinishReading = async () => {
    if (!sessionData) return;
    setIsFinishing(true);
    const actualMinutes = Math.round((totalSeconds - timeLeft) / 60) || 1;
    try {
      await fetchApi(`/sessions/${sessionData.session_id}/finish-reading`, {
        method: 'POST',
        body: JSON.stringify({ actual_duration_minutes: actualMinutes }),
      });
      navigate(`/test/${sessionData.session_id}`);
    } catch (err) {
      toast({ kind: 'warning', message: `The test couldn't be opened just now: ${err.message}` });
      setIsFinishing(false);
    }
  };

  const handleAbandon = () => navigate('/');

  // The planner's reason, as a note over the first page of today's reading; the closing page with the test.
  const note = useMemo(() => sessionData && !pagesOnly && (
    <>
      <ReadingLamp className="rf-note-lamp" />
      <p>
        <strong>Today: about {sessionData.focus_duration_minutes} minutes.</strong>
        {sessionData.reason ? ` ${sessionData.reason}` : ''}
      </p>
    </>
  ), [sessionData, pagesOnly]);
  // The closing page mounts only when it is shown, so its lamp's one glow pulse (moment 3) lands then.
  const closing = pagesOnly ? (
    <>
      <ReadingLamp className="rf-end-lamp" />
      <h2 className="rf-end-title">That's the end of the book.</h2>
      <p className="rf-end-text">Your first session starts once every page has been read.</p>
    </>
  ) : (
    <>
      <ReadingLamp className="rf-end-lamp" />
      <h2 className="rf-end-title">That's today's reading.</h2>
      <p className="rf-end-text">When you're ready, a short test on what you read.</p>
      <Button onClick={handleFinishReading} loading={isFinishing} loadingLabel="Saving…">Start test</Button>
    </>
  );

  // One quiet loading state while the profile and then the session load (C13.8b: the profile check showed nothing).
  const preparing = (
    <div className="rf-reading-loading" role="status">
      <span className="rf-reading-loading-text">Preparing your session…</span>
    </div>
  );

  if (!profileChecked) return preparing;

  if (!isCalibrated) return <CalibrationFlow onComplete={() => setIsCalibrated(true)} />;

  if (loading) return preparing;

  const running = timerStatus === 'running';
  const bookTitle = sessionData.book?.title || 'Your book';

  return (
    <div className="rf-reading-page" data-focus={inFocus}>
      <div className="rf-reading-chrome">
        {inFocus ? (
          <FocusBar session={focus.session} readAt={focus.readAt} locked={focusLocked}
            startLabel={startLabel(body.bodyStart)} idle={focus.idle} idleLapsed={focus.idleLapsed} busy={focusBusy}
            onStart={startFocus} onPause={() => focusDo(focus.pause, '')} onResume={() => focusDo(focus.resume, '')}
            onEnd={endFocus} onLeave={leaveFocus} onAnswerIdle={focus.answerIdle} />
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
          {outside && (
            <button type="button" className="rf-tool" onClick={backToToday}>
              <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>Today's reading</span>
            </button>
          )}
          {pagesOnly ? (
            <div className="rf-toolbar-group rf-toolbar-session" role="group" aria-label="Pages read">
              <span className="rf-session-time" role="status">
                {preparingFirst ? 'Preparing your first session…' : `Reading this scan: ${readCount} of ${scannedCount} pages`}
              </span>
            </div>
          ) : (
          <div className="rf-toolbar-group rf-toolbar-session" role="group" aria-label="Session">
            <span className="rf-session-time" role="timer" aria-label={`Time left ${formatTime(timeLeft)}`}>{formatTime(timeLeft)}</span>
            <button type="button" className="rf-tool" onClick={() => setTimerStatus(running ? 'paused' : 'running')}
              aria-label={running ? 'Pause the timer' : timerStatus === 'idle' ? 'Start the timer' : 'Resume the timer'}>
              {running ? <Pause size={18} strokeWidth={1.75} aria-hidden="true" /> : <Play size={18} strokeWidth={1.75} aria-hidden="true" />}
              {/* C13.9: a stopped clock says so in words, at every width (a play icon alone read as running). */}
              {!running && <span className="rf-session-cue">{timerStatus === 'idle' ? 'Start' : 'Resume'}</span>}
            </button>
            <button type="button" className="rf-tool" onClick={handleFinishReading} disabled={isFinishing}>
              {isFinishing ? 'Saving…' : 'Done reading'}
            </button>
            <button type="button" className="rf-tool" onClick={() => setShowAbandonModal(true)} aria-label="Abandon session">
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          )}
        </ReaderToolbar>
        )}
      </div>

      <SteveContext.Provider value={pagesOnly ? null : steveActions}>
      <NotesContext.Provider value={notesActions}>
      <div className="rf-reading-body">
      <main className="rf-reading-area">
        {/* C13.9: the page's one h1 for assistive tech; the book's own headings are the publisher's. */}
        <h1 className="sr-only">{bookTitle}: today's reading</h1>
        <Reader
          ref={reader}
          kind={kind}
          bookId={bookId}
          title={bookTitle}
          zoom={zoom}
          settings={settings}
          onReady={locate}
          onRelocate={onRelocate}
          onBookmark={onBookmark}
          onBack={() => navigate('/')}
          bounds={bounds}
          opening={!bounds}
          note={inFocus ? null : note}
          closing={closing}
          status={outside ? "Beyond today's reading" : beforeBody(place, body.bodyStart) ? `Focus mode starts at ${startLabel(body.bodyStart)}` : null}
          label={outside ? `${bookTitle}: beyond today's reading, it does not count toward today's session` : `Today's reading from ${bookTitle}`}
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
        />
      </main>
      {side && !inFocus && (
        <SidePanel
          tabs={[
            { id: 'notes', label: 'Notes', count: notepad.notes.length },
            ...(pagesOnly ? [] : [{ id: 'steve', label: 'Steve', mark: <span className="rf-steve-av rf-steve-av--sm" aria-hidden="true">S</span> }]),
          ]}
          current={side}
          onTab={setSide}
          onClose={closeSide}
          returnTo={opener}
          wide={side === 'notes' && drawingOpen}
        >
          {side === 'steve' ? (
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

      <Modal isOpen={leavingFocus} onClose={() => setLeavingFocus(false)} title="Leave focus mode?">
        <p className="rf-leave-text">End the session now and answer a few questions to keep its points, or discard it and
          nothing is scored. Your place in the book is kept either way.</p>
        <div className="rf-leave-actions rf-leave-actions--stack">
          <Button onClick={() => { setLeavingFocus(false); endFocus(); }} disabled={focusBusy}>End and take the quiz</Button>
          <Button variant="secondary" onClick={() => setLeavingFocus(false)}>Keep focusing</Button>
          <Button variant="secondary" onClick={discardFocus} disabled={focusBusy}>Discard session</Button>
        </div>
      </Modal>

      <Modal isOpen={showAbandonModal} onClose={() => setShowAbandonModal(false)} title="Leave today's reading?">
        <p className="rf-leave-text">Your place in the book is kept. This session's reading time won't count, and its test won't open.</p>
        <div className="rf-leave-actions">
          <Button variant="secondary" onClick={handleAbandon}>Leave</Button>
          <Button onClick={() => setShowAbandonModal(false)}>Keep reading</Button>
        </div>
      </Modal>
    </div>
  );
}
