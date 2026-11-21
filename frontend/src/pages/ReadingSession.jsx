import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { bookRecede } from '../motion/presets';
import { fetchApi } from '../lib/api';
import { takeOpened } from '../reader/openAhead';
import { pollWithBackoff } from '../lib/backoff';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Reader } from '../originalview/Reader';
import { fromOpenedBook } from '../originalview/bookFile';
import { ReaderControls } from '../originalview/ReaderControls';
import { createRegionSource } from '../originalview/pdf/regions';
import { createOcrSource } from '../originalview/pdf/ocr';
import { folioShort } from '../originalview/place';
import { usePlaceSaver } from '../reader/usePlaceSaver';
import { ReaderToolbar } from '../reader/ReaderToolbar';
import { useChromeVisible } from '../reader/useChromeVisible';
import { ContentsDrawer } from '../reader/ContentsDrawer';
import { useMedia } from '../reader/useMedia';
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
import { Notebook } from '../notes/Notebook';
import { openingPage, pageFor, pageKey, pagesOf } from '../notes/notebookPages';
import { answerItems, codeItems, imageItems, latexItems, passageItems, typedLines } from '../notes/notebookItems';
import { useNotes } from '../notes/useNotes';
import { notesApi } from '../notes/notesApi';
import { moveTyped, movedStore, typedNotes } from '../notes/moveTyped';
import { serveOwnFonts } from '../notes/excalidrawFonts';
import { chapterOf, reference } from '../notes/place';
import { base64Of, newPageContent } from '../notes/drawing';
import { shownRange } from '../notes/sync';
import { NotesContext } from '../notes/NotesContext';
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
  const [pageView, setPageView] = useStored('rf-pdf-view', 'one'); // C38.4a: Edge's Page view, on this device
  const [pinned, setPinned] = useStored('rf-toolbar-pinned', true); // C38.4b: Edge's toolbar is pinned until unpinned
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
  // C37.2 (issue 26): the notebook over 70 % of the screen, the book blurred beside it; it keeps the page it was on.
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [notebookPage, setNotebookPage] = useState(null);
  const notebookOpener = useRef(null);
  // C37.7: the book recedes as the notebook slides in (rack focus); under reduced motion it blurs in place.
  const reduced = useReducedMotion();
  const recede = !notebookOpen ? 'sharp' : reduced ? 'blurred' : 'receded';
  const [entries, setEntries] = useState([]);
  const [quizMeOpen, setQuizMeOpen] = useState(false); // C23.7b
  const [quizMeBusy, setQuizMeBusy] = useState(false);
  const chromeVisible = useChromeVisible(pinned || toolbarFocused || contentsOpen || quizMeOpen);
  const contentsButton = useRef(null);
  const reader = useRef(null);
  const { toast } = useToast();
  const notes = useAnnotations(bookId); // C21.2: highlights and underlines
  const kind = sessionData?.book?.format === 'epub' ? 'epub' : 'pdf';
  // C18.6d: a PDF's math, code and figure boxes, so lookup skips them (an EPUB's markup already says).
  const regions = useMemo(() => (kind === 'pdf' ? createRegionSource(fetchApi, bookId) : null), [kind, bookId]);
  // C19.4: scanned pages get a text layer read by OCR in this browser. A fully scanned book with no chunks
  // opens pages-only (no session, no test) and has every scanned page read in turn; then it is read again.
  const pagesOnly = Boolean(sessionData?.pages_only);
  // C26.3: a book opened before it is processed (GET /books/{id}/open): no session, its place saved on the book,
  // and "Preparing the book… n%" until its ingest is done; C36 (issue 27): what is read is quizzed meanwhile.
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
    const stop = pollWithBackoff(check); // C35.6 (issue 17): 5 s, 10, 20, 40, then every 60 s
    return () => { live = false; stop(); };
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

  // C38.6a (issue 22): from 1024 px the contents are Edge's left pane, beside the pages; below, the drawer.
  const docked = useMedia('(min-width: 1024px)');
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
    if (!docked) setContentsOpen(false); // C38.6a: the pane stays beside the pages
    const [anchor] = annotation.anchors;
    reader.current?.goTo(anchor.kind === 'epub' ? { cfi: anchor.cfi } : anchor);
  }, [docked]);
  // C38.6b: the Pages tab (a PDF): thumbnails drawn by the reader, a pick goes to the page.
  const thumbnail = useCallback((n, width) => reader.current?.thumbnail?.(n, width) ?? Promise.resolve(null), []);
  const onPickPage = useCallback((page) => {
    if (!docked) setContentsOpen(false);
    reader.current?.goTo({ kind: 'pdf', page });
  }, [docked]);
  const onPick = useCallback((entry) => {
    if (!docked) setContentsOpen(false);
    reader.current?.goTo(entry.target);
  }, [docked]);
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
  // C36.7b: as the Quiz me dialog opens, the server starts making the questions both ranges lack.
  const openQuizMe = async () => {
    setQuizMeOpen(true);
    try {
      const places = (await reader.current?.shownPlaces?.()) ?? [];
      const anchor = places.at(-1)?.anchor ?? reader.current?.anchor();
      if (anchor) fetchApi('/focus/quiz-me/prepare', { method: 'POST', body: JSON.stringify({ book_id: bookId, anchor }) }).catch(() => {});
    } catch { /* the quiz itself still works */ }
  };
  // C23.7b: Quiz me outside focus mode, to the end of the page(s) shown; no points.
  const quizMe = async (scope) => {
    setQuizMeBusy(true);
    try {
      const places = (await reader.current?.shownPlaces?.()) ?? [];
      const anchor = places.at(-1)?.anchor ?? reader.current?.anchor();
      const built = await fetchApi('/focus/quiz-me', { method: 'POST', body: JSON.stringify({ book_id: bookId, scope, anchor }) });
      navigate(`/quiz/${built.session_id}`, { state: { questions: built.questions } }); // C36.7c: shown at once
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
  const tooEarly = () => toast({ kind: 'warning', message: 'The book is still opening. Try again in a moment.' });
  // C22.3, C37.2: a new notebook page at the selection, else the pages shown; its key, so it opens.
  const newPage = async () => {
    const place = await reader.current?.notePlace();
    if (!place) { tooEarly(); return null; }
    return notepad.create({ kind: 'drawing', scope: place.scope, anchors: place.anchors, position_start: place.start,
      position_end: place.end, content: newPageContent() });
  };
  // A margin marker of typed or block notes, and the notebook's "All notes", open the notepad's list.
  const [noteRequest, setNoteRequest] = useState(null);
  const openNotes = () => setSide((now) => { if (!now) opener.current = notesButton.current; return 'notes'; });
  const pages = useMemo(() => pagesOf(notepad.notes), [notepad.notes]);
  // C37.4 (issue 25, D1 A): the first time the notebook opens, typed notes become pages at their places (each note
  // deleted only once its page is saved); what fails stays in All notes and is tried at the next opening.
  const [moving, setMoving] = useState(false);
  const movingNow = useRef(false);
  const moveTypedNotes = async () => {
    if (movingNow.current || notepad.state !== 'ready' || !typedNotes(notepad.notes).length) return;
    movingNow.current = true;
    setMoving(true);
    let result = { moved: 0, failed: 1 };
    try {
      serveOwnFonts(); // Excalidraw's fonts from our own origin, before its chunk runs
      const { facesFor, textElements, TOP_LEFT } = await import('../notes/pageText');
      result = await moveTyped(notepad.notes, {
        lines: (note) => { const at = describeNote(note); return typedLines(note.content, reference(at.page, at.chapter)); },
        elements: async (lines) => { await facesFor(lines); return textElements(lines, TOP_LEFT); },
        create: (body) => notesApi.create(bookId, body),
        remove: (id) => notesApi.remove(id),
        moved: movedStore(),
      });
    } catch { /* the editor's chunk did not load: nothing moved, nothing deleted */ }
    movingNow.current = false;
    setMoving(false);
    notepad.reload();
    if (result.failed) toast({ kind: 'warning', message: "Some typed notes weren't moved yet. They stay in All notes and move the next time you open the notebook." });
    else if (result.moved) toast({ kind: 'neutral', message: result.moved === 1 ? 'Your typed note is now a page in the notebook.' : `Your ${result.moved} typed notes are now pages in the notebook.` });
  };
  const openNotebook = (key = null) => {
    moveTypedNotes();
    // The notepad gives way to the notebook (it would cover the book's 30 %); Steve stays, over that 30 %.
    if (!notebookOpen) notebookOpener.current = side === 'notes' ? notesButton.current : document.activeElement;
    setSide((now) => (now === 'notes' ? null : now));
    setNotebookPage((last) => key ?? openingPage(pages, shown, last));
    setNotebookOpen(true);
  };
  // C37.3 (issue 25): every note goes into the notebook, onto the page started last in the place's chapter, else a
  // new page there (linked to the highlight or region it came from); the notebook opens on it and the editor adds
  // the lines (notebookItems.js).
  const [incoming, setIncoming] = useState(null);
  const whereIs = (place) => {
    const at = { anchors: place.anchors, position_start: place.start };
    return reference(reader.current?.pageLabel(at) ?? '', chapterOf(at, reader.current?.toc() ?? []));
  };
  const toNotebook = (place, lines, { annotationId = null, regionId = null } = {}) => {
    if (!place) { tooEarly(); return null; }
    const key = pageFor(pages, place.start, reader.current?.toc() ?? []) ?? notepad.create({ kind: 'drawing', scope: place.scope,
      anchors: place.anchors, position_start: place.start, position_end: place.end, content: newPageContent(),
      ...(annotationId ? { annotation_id: annotationId } : {}), ...(regionId ? { region_id: regionId } : {}) });
    if (lines.length) setIncoming({ key, lines, n: Date.now() });
    openNotebook(key);
    return key;
  };
  const passageOfPlace = (place) => (place?.anchors ?? []).map((a) => a.text ?? '').filter(Boolean).join(' ');
  // N or the selection toolbar's Note: the selected passage (read before it is cleared), else the pages shown.
  const newNote = async () => {
    const place = await reader.current?.notePlace();
    toNotebook(place, place && passageOfPlace(place) ? passageItems(passageOfPlace(place), whereIs(place)) : []);
  };
  const closeNotebook = useCallback(() => setNotebookOpen(false), []);
  const doneIncoming = useCallback((n) => setIncoming((now) => (now?.n === n ? null : now)), []);
  // C37.6: a picture put on a notebook page goes to the reader's notes folder first; a refusal is said once.
  const uploadPicture = async (blob, pageId) => {
    try {
      return await notepad.uploadImage(await base64Of(blob), blob.type, pageId);
    } catch (err) {
      toast({ kind: 'warning', message: "That picture wasn't kept: it couldn't be uploaded. It stays on the page until you close it." });
      throw err;
    }
  };
  const onOpenNotes = (ids) => {
    const drawn = ids.map((id) => pages.find((p) => p.id === id || p.key === id)).filter(Boolean);
    if (drawn.length && drawn.length === ids.length) { openNotebook(pageKey(drawn[0])); return; } // C37.2: pages
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
  // C22.6: notes made from the book's blocks; since C37.6 (issue 25, D2 A) every one goes onto a notebook page: code
  // and an equation with its LaTeX as text (C37.3), a figure or an equation with no LaTeX as its picture (the crop
  // uploaded to the reader's notes folder first) and its caption.
  const { edit: editNote, uploadImage } = notepad;
  const toNotebookRef = useRef(toNotebook);
  useEffect(() => { toNotebookRef.current = toNotebook; });
  const addFromBook = useCallback(async ({ kind, place, content, imageB64 = null, regionId = null }) => {
    if (!place) {
      toast({ kind: 'warning', message: "That wasn't added to your notes. Try again." });
      return { key: null, content };
    }
    if (kind === 'code' || (kind === 'equation' && content?.latex)) {
      const lines = kind === 'code' ? codeItems(content.code) : latexItems(content.latex);
      return { key: toNotebookRef.current(place, lines, { regionId }), content };
    }
    const caption = kind === 'figure' ? content?.caption ?? '' : '';
    let lines = caption ? passageItems(caption) : [];
    if (imageB64) {
      try {
        const { path } = await uploadImage(imageB64);
        lines = imageItems({ dataURL: `data:image/png;base64,${imageB64}`, path, mimeType: 'image/png' }, caption);
      } catch {
        toast({ kind: 'warning', message: "The picture wasn't saved, so only its caption goes on the page." });
      }
    }
    return { key: toNotebookRef.current(place, lines, { regionId }), content };
  }, [uploadImage, toast]);
  const notesActions = useMemo(() => ({ add: addFromBook, edit: editNote }), [addFromBook, editNote]);
  // A highlight's Note: its passage on the notebook page, the page linked to the highlight when it is new.
  const noteOnHighlight = (annotation) => {
    const place = { scope: 'selection', anchors: annotation.anchors, start: annotation.position_start, end: annotation.position_end };
    toNotebook(place, passageItems(passageOfPlace(place), whereIs(place)), { annotationId: annotation.id });
  };
  // Steve's Save to notes: his answer and its sources on the page for the passage asked about, else the pages shown.
  const saveAnswer = async ({ text, citations, heading }) => {
    const place = await reader.current?.notePlace();
    const key = toNotebook(place, answerItems(text, citations, heading));
    if (key) toast({ kind: 'neutral', message: 'Saved to your notebook.' });
    return key;
  };
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
        const opened = await (takeOpened(bookId) ?? fetchApi(`/books/${bookId}/open`)); // C35.4: begun on the click
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

  const contents = (
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
      docked={docked}
      pages={kind === 'pdf' && place?.total ? {
        total: place.total, current: place.page, labelOf: (n) => reader.current?.pageLabelOf?.(n) ?? String(n), thumbnail, onPick: onPickPage,
      } : null}
    />
  );

  return (
    <div className="rf-reading-page" data-focus={inFocus} data-notebook={notebookOpen || undefined}>
      <m.div className="rf-reading-chrome" inert={notebookOpen} variants={bookRecede} initial={false} animate={recede === 'receded' ? 'blurred' : recede}>
        {inFocus ? (
          <FocusBar session={focus.session} readAt={focus.readAt} locked={focusLocked}
            startLabel={startLabel(body.bodyStart)} idle={focus.idle} idleLapsed={focus.idleLapsed} busy={focusBusy}
            onStart={startFocus} onPause={() => focusDo(focus.pause, '')} onResume={() => focusDo(focus.resume, '')}
            onEnd={endFocus} onLeave={focus.readOnly ? () => navigate('/') : leaveFocus} onAnswerIdle={focus.answerIdle}
            placing={placingRibbon} readOnly={focus.readOnly} folio={place?.folio ?? null}
            onNotes={() => openNotebook()} notesOpen={notebookOpen} notesRef={notesButton}
            notesCount={notepad.notes.length} onSteve={steveHere ? () => toggleSide('steve', steveButton) : undefined}
            steveOpen={steveOpen} steveRef={steveButton} />
        ) : (
        <ReaderToolbar
          bookTitle={bookTitle}
          chapter={chapter}
          onBack={() => navigate('/')}
          visible={chromeVisible}
          pinned={pinned}
          onPin={() => setPinned(!pinned)}
          onFocusChange={setToolbarFocused}
          controls={(
            <ReaderControls kind={kind} zoom={zoom} onZoom={setZoom} settings={settings} onSettings={setSettings}
              place={place} onGoToPage={(page) => reader.current?.goTo(kind === 'pdf' ? { kind: 'pdf', page } : { location: page })}
              pageView={pageView} onPageView={setPageView}
              onFind={() => reader.current?.openFind?.()} />
          )}
          onContents={openContents}
          contentsOpen={contentsOpen}
          contentsDocked={docked}
          contentsRef={contentsButton}
          lookupOn={hoverLookup}
          onLookupToggle={onLookupToggle}
          onNotes={() => openNotebook()}
          notesOpen={notebookOpen}
          notesRef={notesButton}
          notesCount={notepad.notes.length}
          onSteve={pagesOnly ? undefined : () => toggleSide('steve', steveButton)}
          steveOpen={steveOpen}
          steveRef={steveButton}
          onFocusMode={pagesOnly ? undefined : turnFocusOn}
        >
          {!pagesOnly && (
            <button type="button" className="rf-tool" onClick={openQuizMe}>
              <span>Quiz me</span>
            </button>
          )}
          {processing && !quizzesDone ? (
            <div className="rf-toolbar-group rf-toolbar-session" role="group" aria-label="Book preparation">
              <span className="rf-session-time" role="status">
                {prepared?.progress != null ? `Preparing the book… ${Math.round(prepared.progress * 100)}%` : 'Preparing the book…'}
              </span>
            </div>
          ) : null}
          {pagesOnly ? (
            <div className="rf-toolbar-group rf-toolbar-session" role="group" aria-label="Pages read">
              <span className="rf-session-time" role="status">
                {preparingFirst ? 'Preparing the book…' : `Reading this scan: ${readCount} of ${scannedCount} pages`}
              </span>
            </div>
          ) : null}
        </ReaderToolbar>
        )}
      </m.div>

      <SteveContext.Provider value={steveHere ? steveActions : null}>
      <NotesContext.Provider value={notesActions}>
      <div className="rf-reading-body">
      {docked && <div className="rf-reading-pane" inert={notebookOpen}>{contents}</div>}
      <m.main className="rf-reading-area" inert={notebookOpen} variants={bookRecede} initial={false} animate={recede}>
        {/* C13.9: the page's one h1 for assistive tech; the book's own headings are the publisher's. */}
        <h1 className="sr-only">{bookTitle}</h1>
        <Reader
          ref={reader}
          kind={kind}
          bookId={bookId}
          load={loadFile}
          title={bookTitle}
          zoom={zoom}
          pageView={pageView}
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
      </m.main>
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
          beside={notebookOpen}
        >
          {shownSide === 'steve' ? (
            <StevePanel steve={steve} chapter={chapter} onCite={onCite} onClose={closeSide} onSaveNote={saveAnswer} />
          ) : (
            <Notepad notes={notepad.notes} state={notepad.state} statuses={notepad.statuses} describe={describeNote}
              onGoTo={goToNote} onRemove={notepad.remove} onReload={notepad.reload} onRetry={notepad.flush}
              onKeepMine={notepad.keepMine} onTakeTheirs={notepad.takeTheirs} onChange={notepad.edit}
              onOpenPage={(note) => openNotebook(pageKey(note))} onNotebook={() => openNotebook()}
              onRelink={relinkNote} request={noteRequest} range={shown} contents={contentsOf} />
          )}
        </SidePanel>
      )}
      </div>
      <AnimatePresence>
      {notebookOpen && (
        <Notebook key="notebook" title={bookTitle} pages={pages} state={notepad.state} statuses={notepad.statuses} range={shown}
          describe={describeNote} current={notebookPage} onPage={setNotebookPage} onNew={newPage}
          onChange={notepad.edit} onThumbnail={notepad.attachThumbnail} onRemove={notepad.remove} onGoTo={goToNote}
          onRetry={notepad.flush} onKeepMine={notepad.keepMine} onTakeTheirs={notepad.takeTheirs} onReload={notepad.reload}
          onClose={closeNotebook} returnTo={notebookOpener} beside={Boolean(shownSide)}
          total={notepad.notes.length} onAll={openNotes} incoming={incoming} onIncoming={doneIncoming} moving={moving}
          onUpload={uploadPicture} />
      )}
      </AnimatePresence>
      </NotesContext.Provider>
      </SteveContext.Provider>

      {!docked && contents}

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
