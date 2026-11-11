import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pause, Play, X } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { CalibrationFlow } from '../components/CalibrationFlow';
import { BookReader } from '../reader';
import { blocksForChunks, placeInChunks } from '../reader/blocks';
import { usePlaceSaver } from '../reader/usePlaceSaver';
import { createReadAhead } from '../reader/readAhead';
import { ReaderToolbar } from '../reader/ReaderToolbar';
import { useChromeVisible } from '../reader/useChromeVisible';
import { ContentsDrawer } from '../reader/ContentsDrawer';
import { useToast } from '../components/ui/toastContext';
import { readSize, stepSize, storeSize } from '../reader/textSize';
import { createLookupClient, readLookupOn, storeLookupOn } from '../reader/lookup';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ReadingLamp } from '../illustrations';
import './ReadingSession.css';

// One read-ahead cache for the app: the chunk after today's reading, fetched before the last page (C12.4).
const readAhead = createReadAhead(fetchApi);
// One lookup client for the app: its LRU of recent answers lasts the visit (C12.8).
const lookupClient = createLookupClient(fetchApi);

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

/**
 * The reading page (C12.5a): today's session as a paginated book under a
 * toolbar that fades while reading. The planner's reason is a note on the
 * first page, the last page says "That's today's reading" with Start test,
 * and the pacing line counts the pages left. Calibration, the countdown
 * (Start, Pause, Resume, auto-pause at zero), Done reading and the abandon
 * modal behave as before.
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
  const [textSize, setTextSize] = useState(readSize);
  const { user } = useAuth();
  // Hover lookup (C12.8): this user's stored choice, or what they just switched to on this visit.
  const [switched, setSwitched] = useState(null); // { userId, on }
  const hoverLookup = switched && switched.userId === user?.id ? switched.on : readLookupOn(user?.id);
  const [chapter, setChapter] = useState('');
  const [toolbarFocused, setToolbarFocused] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  // A chapter outside today's chunks, opened from the contents (D4): read-only, it counts for nothing.
  const [aside, setAside] = useState(null); // { entry, chunks }
  const [backTo, setBackTo] = useState(null); // the place in today's pages to reopen when coming back
  const chromeVisible = useChromeVisible(toolbarFocused || showAbandonModal || contentsOpen);
  const contentsButton = useRef(null);
  const reader = useRef(null);
  const todayPlace = useRef(null); // where the reader was in today's pages, to come back to
  const { toast } = useToast();

  // The book (C12.3b): today's blocks, the saved place if it is in today's chunks, saved again as pages turn.
  const blocks = useMemo(() => blocksForChunks(sessionData?.chunks), [sessionData]);
  const resumeAt = useMemo(() => placeInChunks(sessionData?.position, sessionData?.chunks), [sessionData]);
  const { save, saveNow } = usePlaceSaver(sessionData?.session_id);
  const savePlace = useCallback((place) => { todayPlace.current = place; save(place); }, [save]);
  const onBookmark = useCallback((place, pageNumber) => {
    todayPlace.current = place;
    saveNow(place);
    toast({ kind: 'neutral', message: `Place saved at page ${pageNumber}.` });
  }, [saveNow, toast]);
  const todayChunks = useMemo(() => new Set(sessionData?.chunk_indices ?? []), [sessionData]);
  const closeContents = useCallback(() => setContentsOpen(false), []);
  const onPick = useCallback(async (entry) => {
    setContentsOpen(false);
    if (todayChunks.has(entry.chunk_index)) {
      if (aside) { setBackTo({ block_id: entry.block_id, char_offset: 0 }); setAside(null); }
      else reader.current?.goToPlace({ block_id: entry.block_id, char_offset: 0 });
      return;
    }
    try {
      const data = await fetchApi(`/books/${bookId}/pages?start=${entry.chunk_index}&end=${entry.chunk_index + 1}`);
      if (!data.chunks?.length) return;
      if (!aside) setBackTo(todayPlace.current);
      setAside({ entry, chunks: data.chunks });
    } catch {
      toast({ kind: 'warning', message: "That chapter couldn't be opened just now." });
    }
  }, [aside, bookId, todayChunks, toast]);
  const lastChunk = sessionData?.chunk_indices?.length ? Math.max(...sessionData.chunk_indices) : null;
  const preloadNext = useCallback(() => {
    if (lastChunk !== null) readAhead.load(bookId, lastChunk + 1);
  }, [bookId, lastChunk]);
  const onPagesChange = useCallback((pages) => setChapter(pages.chapter || ''), []);
  const asideBlocks = useMemo(() => (aside ? blocksForChunks(aside.chunks) : null), [aside]);
  const onLookupToggle = () => {
    storeLookupOn(user?.id, !hoverLookup);
    setSwitched({ userId: user?.id, on: !hoverLookup });
  };
  const onSize = (direction) => setTextSize((size) => {
    const next = stepSize(size, direction);
    storeSize(next);
    return next;
  });

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

  // The planner's reason, once, as a note on the first page; the closing page with the test.
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
          size={textSize}
          onSize={onSize}
          onBack={() => navigate('/')}
          visible={chromeVisible}
          onFocusChange={setToolbarFocused}
          onContents={() => setContentsOpen((open) => !open)}
          contentsOpen={contentsOpen}
          contentsRef={contentsButton}
          lookupOn={hoverLookup}
          onLookupToggle={onLookupToggle}
        >
          {aside && (
            <button type="button" className="rf-tool" onClick={() => setAside(null)}>
              <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>Today's reading</span>
            </button>
          )}
          <div className="rf-toolbar-group" role="group" aria-label="Session">
            <span className="rf-session-time" aria-label={`Time left ${formatTime(timeLeft)}`}>{formatTime(timeLeft)}</span>
            <button type="button" className="rf-tool" onClick={() => setTimerStatus(running ? 'paused' : 'running')}
              aria-label={running ? 'Pause the timer' : timerStatus === 'idle' ? 'Start the timer' : 'Resume the timer'}>
              {running ? <Pause size={18} strokeWidth={1.75} aria-hidden="true" /> : <Play size={18} strokeWidth={1.75} aria-hidden="true" />}
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
        {aside ? (
          <BookReader
            key={`aside-${aside.entry.block_id}`}
            blocks={asideBlocks}
            bookTitle={bookTitle}
            fontSize={textSize}
            initialAnchor={{ block_id: aside.entry.block_id, char_offset: 0 }}
            onPagesChange={onPagesChange}
            statusNote="Beyond today's reading"
            lookupClient={lookupClient}
            hoverLookup={hoverLookup}
            label={`${aside.entry.title}: beyond today's reading, it does not count toward today's session`}
          />
        ) : (
          <BookReader
            key="today"
            ref={reader}
            blocks={blocks}
            bookTitle={bookTitle}
            chapterBefore={sessionData.chapter_before || ''}
            fontSize={textSize}
            initialAnchor={backTo || resumeAt}
            onPlaceChange={savePlace}
            onPagesChange={onPagesChange}
            onNearEnd={preloadNext}
            onBookmark={onBookmark}
            lead={note}
            endPage={closing}
            pacing
            lookupClient={lookupClient}
            hoverLookup={hoverLookup}
            label={`Today's reading from ${bookTitle}`}
          />
        )}
      </main>

      <ContentsDrawer
        open={contentsOpen}
        onClose={closeContents}
        toc={sessionData.book?.toc ?? []}
        todayChunks={todayChunks}
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
