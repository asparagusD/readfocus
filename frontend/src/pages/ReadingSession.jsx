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
  const [entries, setEntries] = useState([]);
  const chromeVisible = useChromeVisible(toolbarFocused || showAbandonModal || contentsOpen);
  const contentsButton = useRef(null);
  const reader = useRef(null);
  const { toast } = useToast();
  const kind = sessionData?.book?.format === 'epub' ? 'epub' : 'pdf';
  const { theme, original, toggleOriginal } = useLamplight(bookId);

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
    setContentsOpen((open) => !open);
  };
  const onPick = useCallback((entry) => {
    setContentsOpen(false);
    reader.current?.goTo(entry.target);
  }, []);
  const backToToday = () => reader.current?.goTo(todayAnchor.current ?? bounds?.start);
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
  const note = useMemo(() => sessionData && (
    <>
      <ReadingLamp className="rf-note-lamp" />
      <p>
        <strong>Today: about {sessionData.focus_duration_minutes} minutes.</strong>
        {sessionData.reason ? ` ${sessionData.reason}` : ''}
      </p>
    </>
  ), [sessionData]);
  // The closing page mounts only when it is shown, so its lamp's one glow pulse (moment 3) lands then.
  const closing = (
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
    <div className="rf-reading-page">
      <div className="rf-reading-chrome">
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
        >
          {outside && (
            <button type="button" className="rf-tool" onClick={backToToday}>
              <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>Today's reading</span>
            </button>
          )}
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
        </ReaderToolbar>
      </div>

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
          note={note}
          closing={closing}
          status={outside ? "Beyond today's reading" : null}
          label={outside ? `${bookTitle}: beyond today's reading, it does not count toward today's session` : `Today's reading from ${bookTitle}`}
          lookupClient={lookupClient}
          hoverLookup={hoverLookup}
        />
      </main>

      <ContentsDrawer
        open={contentsOpen}
        onClose={closeContents}
        entries={entries}
        current={chapter}
        onPick={onPick}
        returnTo={contentsButton}
      />

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
