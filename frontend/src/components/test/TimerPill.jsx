import { Timer } from 'lucide-react';
import './TimerPill.css';

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** What to say once, politely, as the time crosses a mark; nothing in between (no second-by-second chatter). */
function notice(seconds) {
  if (seconds === 0) return 'Time is up.';
  if (seconds <= 30) return '30 seconds left.';
  if (seconds <= 60) return 'One minute left.';
  return '';
}

/**
 * The test's timer (handoff test chrome): a calm pill that turns --warn on
 * --warn-soft only in the last 30 seconds. role="timer" is not announced
 * every second; a separate polite line speaks at one minute, 30 seconds
 * and zero.
 */
export function TimerPill({ seconds, warnAt = 30 }) {
  const warn = seconds <= warnAt;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return (
    <div className="rf-timer" data-warn={warn || undefined}>
      <span role="timer" aria-label={`Time left: ${minutes} min ${rest} s`} className="rf-timer__face">
        <Timer size={16} strokeWidth={1.75} aria-hidden="true" />
        <span aria-hidden="true">{clock(seconds)}</span>
      </span>
      <span className="rf-timer__notice" aria-live="polite">{notice(seconds)}</span>
    </div>
  );
}
