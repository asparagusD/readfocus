import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bookmark, Pause, Play, X } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { usePageTransition } from '../hooks/usePageTransition';
import { CalibrationFlow } from '../components/CalibrationFlow';
import { BookReader } from '../reader';
import { blocksForChunks, placeInChunks } from '../reader/blocks';
import { usePlaceSaver } from '../reader/usePlaceSaver';
import { createReadAhead } from '../reader/readAhead';
import { ReaderToolbar } from '../reader/ReaderToolbar';
import { useChromeVisible } from '../reader/useChromeVisible';
import { readSize, stepSize, storeSize } from '../reader/textSize';
import './ReadingSession.css';

// One read-ahead cache for the app: the chunk after today's reading, fetched before the last page (C12.4).
const readAhead = createReadAhead(fetchApi);

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
  const navigateTo = usePageTransition();
  const navigate = useNavigate();

  const [profileChecked, setProfileChecked] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState(null);

  // Timer state, as before
  const [timeLeft, setTimeLeft] = useState(0); // in seconds
  const [timerStatus, setTimerStatus] = useState('idle'); // 'idle' | 'running' | 'paused'

  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [textSize, setTextSize] = useState(readSize);
  const [chapter, setChapter] = useState('');
  const [toolbarFocused, setToolbarFocused] = useState(false);
  const chromeVisible = useChromeVisible(toolbarFocused || showAbandonModal);

  // The book (C12.3b): today's blocks, the saved place if it is in today's chunks, saved again as pages turn.
  const blocks = useMemo(() => blocksForChunks(sessionData?.chunks), [sessionData]);
  const resumeAt = useMemo(() => placeInChunks(sessionData?.position, sessionData?.chunks), [sessionData]);
  const savePlace = usePlaceSaver(sessionData?.session_id);
  const lastChunk = sessionData?.chunk_indices?.length ? Math.max(...sessionData.chunk_indices) : null;
  const preloadNext = useCallback(() => {
    if (lastChunk !== null) readAhead.load(bookId, lastChunk + 1);
  }, [bookId, lastChunk]);
  const onPagesChange = useCallback((pages) => setChapter(pages.chapter || ''), []);
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
        alert('Failed to start session: ' + err.message);
        navigate('/');
      }
    }
    startSession();
  }, [bookId, navigate, profileChecked, isCalibrated]);

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
      navigateTo(`/test/${sessionData.session_id}`);
    } catch (err) {
      alert('Failed to finish reading: ' + err.message);
      setIsFinishing(false);
    }
  };

  const handleAbandon = () => navigateTo('/');

  // The planner's reason, once, as a note on the first page; the closing page with the test.
  const note = useMemo(() => sessionData && (
    <>
      <Bookmark size={16} strokeWidth={1.75} aria-hidden="true" />
      <p>
        <strong>Today: about {sessionData.focus_duration_minutes} minutes.</strong>
        {sessionData.reason ? ` ${sessionData.reason}` : ''}
      </p>
    </>
  ), [sessionData]);
  const closing = (
    <>
      <h2 className="rf-end-title">That's today's reading.</h2>
      <p className="rf-end-text">When you're ready, a short test on what you read.</p>
      <Button onClick={handleFinishReading} loading={isFinishing} loadingLabel="Saving…">Start test</Button>
    </>
  );

  if (!profileChecked) return <div className="rf-reading-loading" />;

  if (!isCalibrated) return <CalibrationFlow onComplete={() => setIsCalibrated(true)} />;

  if (loading) {
    return (
      <div className="rf-reading-loading">
        <span className="rf-reading-loading-text">Preparing your session…</span>
      </div>
    );
  }

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
          onBack={() => navigateTo('/')}
          visible={chromeVisible}
          onFocusChange={setToolbarFocused}
        >
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
        <BookReader
          blocks={blocks}
          bookTitle={bookTitle}
          chapterBefore={sessionData.chapter_before || ''}
          fontSize={textSize}
          initialAnchor={resumeAt}
          onPlaceChange={savePlace}
          onPagesChange={onPagesChange}
          onNearEnd={preloadNext}
          lead={note}
          endPage={closing}
          pacing
          label={`Today's reading from ${bookTitle}`}
        />
      </main>

      <Modal isOpen={showAbandonModal} onClose={() => setShowAbandonModal(false)} label="Abandon this session?">
        <div style={{ padding: '24px', maxWidth: '400px', boxSizing: 'border-box' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '18px', color: 'var(--ink)', lineHeight: '1.4', marginBottom: '32px' }}>
            If you abandon this session, no progress will be saved and the time you spent reading will not count.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <Button variant="danger" onClick={handleAbandon}>Abandon</Button>
            <Button variant="primary" onClick={() => setShowAbandonModal(false)}>Keep reading</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
