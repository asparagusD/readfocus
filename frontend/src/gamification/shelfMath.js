// The badge shelf, pure (C24.6b, docs/GAMIFICATION.md Badges, handoff screen 26).

export const SEEN_KEY = 'rf-badges-seen';

/** "4 of 14 earned", or a first nudge when none is. */
export function shelfLine(earned, total) {
  return earned > 0 ? `${earned} of ${total} earned` : 'Your first badge comes with your first focus session';
}

/** "Earned 17 Nov 2026" from the server's timestamp, in the reader's own calendar. */
export function earnedOn(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Earned';
  return `Earned ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** The ids earned but not yet shown on this device: they stamp in once. */
export function newlyEarned(badges, seen) {
  const known = new Set(seen);
  return badges.filter((b) => b.earned && !known.has(b.id)).map((b) => b.id);
}

/** The ids to remember as seen after this visit. */
export function seenAfter(badges, seen) {
  return [...new Set([...seen, ...badges.filter((b) => b.earned).map((b) => b.id)])].sort();
}
