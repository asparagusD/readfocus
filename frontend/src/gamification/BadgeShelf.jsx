import { useEffect, useState } from 'react';
import { m } from 'motion/react';
import { BookCheck, BookOpen, Brush, CheckCheck, Flame, Hourglass, MessageCircle, PenLine, Sigma, Timer } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Skeleton } from '../components/ui/Skeleton';
import { easing, prefersReducedMotion, seconds } from '../motion/presets';
import { earnedOn, newlyEarned, SEEN_KEY, seenAfter, shelfLine } from './shelfMath';
import './BadgeShelf.css';

const ICONS = {
  first_focus: Timer, first_chapter: BookOpen, focus_10h: Hourglass, focus_50h: Hourglass, focus_100h: Hourglass,
  perfect_quiz: CheckCheck, streak_7: Flame, streak_30: Flame, streak_100: Flame, first_note: PenLine,
  first_drawing: Brush, first_steve: MessageCircle, finished_book: BookCheck, technical_reader: Sigma,
};

// A wax seal's scalloped rim, as one path around a 64 px circle.
const SEAL = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2;
  const r = i % 2 ? 29 : 31.5;
  return `${i ? 'L' : 'M'}${(32 + r * Math.cos(a)).toFixed(1)} ${(32 + r * Math.sin(a)).toFixed(1)}`;
}).join(' ') + ' Z';

function Emblem({ badge }) {
  const Icon = ICONS[badge.id] ?? Timer;
  if (badge.kind === 'bookplate') {
    return (
      <span className="rf-badge__plate">
        <span className="rf-badge__exlibris">Ex libris</span>
        <Icon size={20} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <span className="rf-badge__seal">
      <svg className="rf-badge__rim" width="64" height="64" viewBox="0 0 64 64"><path d={SEAL} /><circle cx="32" cy="32" r="21" /></svg>
      <Icon size={22} strokeWidth={1.75} />
    </span>
  );
}

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; }
}

/**
 * The badge shelf (C24.6b, handoff screen 26): the 14 badges of GAMIFICATION, habits as wax seals and books as
 * "Ex libris" bookplates. Earned ones are inked with the day they were earned; locked ones are a faint dashed outline
 * with, in full-contrast words, how to earn them. A badge earned since this device last showed the shelf stamps in
 * once (scale 1.25 to 1 with a slight turn, --dur-5); none under reduced motion.
 */
export function BadgeShelf() {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let live = true;
    fetchApi('/badges').then((body) => {
      if (!live) return;
      const seen = readSeen();
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(seenAfter(body.badges, seen))); } catch { /* blocked */ }
      setState({ status: 'ready', ...body, fresh: new Set(newlyEarned(body.badges, seen)) });
    }).catch(() => { if (live) setState({ status: 'error' }); });
    return () => { live = false; };
  }, []);

  if (state.status === 'loading') {
    return <section className="rf-badge-shelf" aria-busy="true" aria-label="Badge shelf"><Skeleton height={140} /></section>;
  }
  if (state.status === 'error') {
    return (
      <section className="rf-badge-shelf" aria-labelledby="rf-badge-shelf-title">
        <h2 id="rf-badge-shelf-title" className="rf-dash__h2">Badge shelf</h2>
        <p className="rf-dash__muted">Your badges didn’t load. They are safe; try again in a moment.</p>
      </section>
    );
  }
  const still = prefersReducedMotion();
  return (
    <section className="rf-badge-shelf" aria-labelledby="rf-badge-shelf-title">
      <div className="rf-dash__section-head">
        <h2 id="rf-badge-shelf-title" className="rf-dash__h2">Badge shelf</h2>
        <p className="rf-dash__muted">{shelfLine(state.earned, state.total)}</p>
      </div>
      <ul className="rf-badge-shelf__list">
        {state.badges.map((badge) => {
          const stamp = state.fresh.has(badge.id) && !still;
          return (
            <li key={badge.id} className={badge.earned ? 'rf-badge is-earned' : 'rf-badge'}>
              <m.span className="rf-badge__emblem" aria-hidden="true" data-stamp={stamp || undefined}
                initial={stamp ? { scale: 1.25, rotate: -8, opacity: 0 } : false}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ duration: seconds('--dur-5'), ease: easing('--ease-arrive') }}>
                <Emblem badge={badge} />
              </m.span>
              <p className="rf-badge__name">{badge.name}</p>
              <p className="rf-badge__line">
                {badge.earned ? earnedOn(badge.awarded_at) : badge.description}
                <span className="rf-badge__sr">{badge.earned ? '' : ' Not earned yet.'}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
