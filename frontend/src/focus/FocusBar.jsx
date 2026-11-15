import { useEffect, useId, useRef, useState } from 'react';
import { Hourglass, Lock, LogOut, Pause, Play } from 'lucide-react';
import { CAP_S, noticeDue, shownSeconds, spokenTime, stopwatch } from './clock';
import './FocusBar.css';

/**
 * Focus mode's bar (C23.6, handoff screens 20-21): it takes the toolbar's place while focus mode is on. Left,
 * the stopwatch pill: locked with a padlock before the book's body start ("Unlocks at Chapter 1", a popover
 * says why), then 00:00 with Start, then the server's time running on between its reads (mm:ss, then h:mm;
 * a breathing dot, still under reduced motion). Right, Pause focus / Resume, End session and Exit focus.
 * Under it, "Still with the book?" after ten quiet minutes and the 2 h 45 notice; neither blocks reading.
 */
export function FocusBar({
  session, readAt, locked, startLabel, idle, idleLapsed, busy, onStart, onPause, onResume, onEnd, onLeave, onAnswerIdle,
  placing = false,
}) {
  const [now, setNow] = useState(() => Date.now());
  const [why, setWhy] = useState(false);
  const [noticeClosed, setNoticeClosed] = useState(false);
  const popover = useId();
  const lockButton = useRef(null);
  const status = session?.status;
  const ticking = status === 'active' && session.state === 'running' && !idleLapsed(now);
  const seconds = session ? shownSeconds({ base: session.active_seconds, readAt, now, ticking }) : 0;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (!why) return undefined;
    const close = (event) => { if (event.key === 'Escape') { setWhy(false); lockButton.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [why]);

  const capped = status === 'awaiting_quiz' && (session.capped || seconds >= CAP_S);
  const notice = status === 'active' && !noticeClosed && noticeDue(seconds) && !capped;

  return (
    <div className="rf-focus" role="region" aria-label="Focus mode">
      <div className="rf-focus-bar">
        <div className="rf-focus-left">
          {!session && locked ? (
            <div className="rf-focus-lockwrap">
              <button type="button" ref={lockButton} className="rf-focus-pill rf-focus-pill--locked" aria-expanded={why}
                aria-controls={popover} onClick={() => setWhy((open) => !open)}>
                <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
                <span>Unlocks at {startLabel}</span>
              </button>
              {why && (
                <div className="rf-focus-popover" id={popover} role="note">
                  <p className="rf-focus-popover-title">The clock starts at {startLabel}.</p>
                  <p>Front matter like the preface and contents doesn&rsquo;t count toward focus time or points.
                    Turn to {startLabel} to start.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="rf-focus-pill" data-state={ticking ? 'running' : status ?? 'ready'}>
              {ticking && <span className="rf-focus-dot" aria-hidden="true" />}
              <span className="rf-focus-time" role="timer" aria-live="off" aria-label={`Focus time: ${spokenTime(seconds)}`}>
                {stopwatch(seconds)}
              </span>
              {status === 'paused' && <span className="rf-focus-state">Paused</span>}
              {session?.state === 'hidden' && status === 'active' && <span className="rf-focus-state">Paused while away</span>}
            </div>
          )}
          <p className="rf-focus-caption">Focus · notes, Steve and badges are tucked away</p>
        </div>
        <div className="rf-focus-actions">
          {!session && !locked && (
            <button type="button" className="rf-focus-button rf-focus-button--primary" onClick={onStart} disabled={busy}>
              <Play size={16} strokeWidth={1.75} aria-hidden="true" /> Start
            </button>
          )}
          {status === 'active' && (
            <button type="button" className="rf-focus-button" onClick={onPause} disabled={busy}>
              <Pause size={16} strokeWidth={1.75} aria-hidden="true" /> Pause focus
            </button>
          )}
          {status === 'paused' && (
            <button type="button" className="rf-focus-button" onClick={onResume} disabled={busy}>
              <Play size={16} strokeWidth={1.75} aria-hidden="true" /> Resume
            </button>
          )}
          {(status === 'active' || status === 'paused' || status === 'awaiting_quiz') && (
            <button type="button" className="rf-focus-button rf-focus-button--primary" onClick={onEnd} disabled={busy}>
              End session
            </button>
          )}
          <button type="button" className="rf-focus-button rf-focus-exit" onClick={onLeave} aria-label="Exit focus mode">
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" /><span className="rf-focus-exit-label">Exit focus</span>
          </button>
        </div>
      </div>

      {/* While the ribbon is being placed its bar is what the reader acts on: the cards step aside (C23.6b). */}
      <div className="rf-focus-notes" aria-live="polite">
        {idle && !placing && (
          <div className="rf-focus-card" role="group" aria-label="Still with the book?">
            <Hourglass size={18} strokeWidth={1.75} aria-hidden="true" className="rf-focus-card-icon" />
            <div>
              <p className="rf-focus-card-title">Still with the book?</p>
              <p className="rf-focus-card-text">{idleLapsed(now)
                ? 'The clock is resting until you’re back.'
                : 'Ten quiet minutes. Any key or scroll says you’re here.'}</p>
            </div>
            <button type="button" className="rf-focus-button" onClick={onAnswerIdle}>I&rsquo;m here</button>
          </div>
        )}
        {notice && !placing && (
          <div className="rf-focus-card" role="group" aria-label="15 minutes left in this focus session">
            <Hourglass size={18} strokeWidth={1.75} aria-hidden="true" className="rf-focus-card-icon" />
            <div>
              <p className="rf-focus-card-title">15 minutes left in this focus session</p>
              <p className="rf-focus-card-text">Sessions stop at three hours so the reading stays fresh. A chapter&rsquo;s
                end is a good place for the ribbon.</p>
            </div>
            <button type="button" className="rf-focus-button" onClick={() => setNoticeClosed(true)}>OK</button>
          </div>
        )}
        {capped && !placing && (
          <div className="rf-focus-card" role="group" aria-label="Three hours of focus">
            <Hourglass size={18} strokeWidth={1.75} aria-hidden="true" className="rf-focus-card-icon" />
            <div>
              <p className="rf-focus-card-title">Three hours of focus</p>
              <p className="rf-focus-card-text">The clock has stopped. Place your bookmark where you stopped reading, then a
                few questions.</p>
            </div>
            <button type="button" className="rf-focus-button rf-focus-button--primary" onClick={onEnd}>Place bookmark</button>
          </div>
        )}
      </div>
    </div>
  );
}
