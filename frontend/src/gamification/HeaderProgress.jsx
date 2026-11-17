import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { m } from 'motion/react';
import { drawIn, prefersReducedMotion, seconds, easing } from '../motion/presets';
import { celebratedKey, flameScale, FREEZE_MAX, headerLabel, levelOf, share } from './progressMath';
import './HeaderProgress.css';

function celebratedOn(day) {
  try { return Boolean(localStorage.getItem(celebratedKey(day))); } catch { return false; }
}

function Candle({ days, freezes }) {
  const scale = flameScale(days);
  return (
    <svg className="rf-hp__candle" width="22" height="28" viewBox="0 0 22 28" aria-hidden="true">
      {scale > 0 && (
        <g className="rf-hp__flame" style={{ transform: `scale(${scale})` }}>
          <path d="M11 2c2.4 3 3.6 5 3.6 7a3.6 3.6 0 0 1-7.2 0c0-2 1.2-4 3.6-7z" />
        </g>
      )}
      <line className="rf-hp__wick" x1="11" y1="10" x2="11" y2="13" />
      <rect className="rf-hp__wax" x="6.5" y="13" width="9" height="14" rx="1.5" />
      {Array.from({ length: FREEZE_MAX }, (_, i) => (
        <path key={i} className={i < freezes ? 'rf-hp__drop is-held' : 'rf-hp__drop'}
          d={`M${2 + i * 15.5} 17c1 1.4 1.6 2.3 1.6 3a1.6 1.6 0 0 1-3.2 0c0-.7.6-1.6 1.6-3z`} />
      ))}
    </svg>
  );
}

/**
 * The header's quiet progress (C24.6a, handoff screens 26 and the app bar): the candle (the flame grows gently with
 * the streak; held streak freezes are the wax drops beside it), today's goal ring and, from 640 px, "Level n" with a
 * slim XP bar. One link to the Dashboard, read as one sentence. Meeting the day's goal is marked once that day with a
 * soft halo on the ring (opacity and scale, 800 ms; none under reduced motion) and a polite "Today's goal is met."
 */
export function HeaderProgress({ progress }) {
  const { level, into, span } = levelOf(progress.total_xp);
  const { day, xp, goal, met } = progress.today;
  // Read once when the header appears (it mounts with the fetched progress); the effect only remembers the day.
  const [celebrate] = useState(() => met && !celebratedOn(day));
  useEffect(() => {
    if (!celebrate) return;
    try { localStorage.setItem(celebratedKey(day), '1'); } catch { /* storage blocked: once per load */ }
  }, [celebrate, day]);

  const ring = share(xp, goal);
  const still = prefersReducedMotion();
  return (
    <>
    <Link to="/dashboard" className="rf-hp" aria-label={headerLabel(progress)}>
      <span className="rf-hp__streak" aria-hidden="true">
        <Candle days={progress.streak.days} freezes={progress.streak.freezes} />
        <span className="rf-hp__days">{progress.streak.days}</span>
      </span>
      <span className={met ? 'rf-hp__goal is-met' : 'rf-hp__goal'} aria-hidden="true">
        {celebrate && !still && (
          <m.span className="rf-hp__halo" initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: [0, 0.9, 0], scale: [0.6, 1.25, 1.4] }}
            transition={{ duration: seconds('--dur-6'), ease: easing('--ease-breathe') }} />
        )}
        <svg width="28" height="28" viewBox="0 0 28 28">
          <circle className="rf-hp__track" cx="14" cy="14" r="11.5" />
          {ring > 0 && (
            <m.circle className="rf-hp__arc" cx="14" cy="14" r="11.5" initial={{ pathLength: 0 }}
              animate={{ pathLength: ring }} transition={drawIn.visible.transition} />
          )}
        </svg>
      </span>
      <span className="rf-hp__level" aria-hidden="true">
        <span className="rf-hp__level-name">Level {level}</span>
        <span className="rf-hp__bar"><span style={{ transform: `scaleX(${share(into, span)})` }} /></span>
      </span>
    </Link>
    {celebrate && <span className="rf-hp__sr" role="status">Today&apos;s goal is met.</span>}
    </>
  );
}
