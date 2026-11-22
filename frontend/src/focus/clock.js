/**
 * Focus mode's clock on the reader's side (C23.6). Display only: the server times and scores the session
 * (FOCUS_RULES F3, F14); the reader shows its last answer and runs on from it between reads. The numbers
 * mirror backend/agents/policy.py (FOCUS_HEARTBEAT_S, FOCUS_IDLE_*, FOCUS_SESSION_CAP_MIN).
 */
export const HEARTBEAT_MS = 30_000;
export const SYNC_MS = 60_000;
export const IDLE_MS = 10 * 60_000;
export const ANSWER_MS = 60_000;
export const CAP_S = 3 * 3600;
export const NOTICE_LEFT_S = 15 * 60;

const two = (n) => String(n).padStart(2, '0');

/** "mm:ss" under an hour, then "h:mm". */
export function stopwatch(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 3600) return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
  return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}`;
}

/** The same time in words, for the stopwatch's accessible name. */
export function spokenTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [h && `${h} hour${h === 1 ? '' : 's'}`, m && `${m} minute${m === 1 ? '' : 's'}`].filter(Boolean);
  return parts.length ? parts.join(' ') : 'no time yet';
}

/** The seconds to show: the server's at `readAt`, running on while the session ticks, never past the cap. */
export function shownSeconds({ base, readAt, now, ticking }) {
  const run = ticking ? Math.max(0, Math.floor((now - readAt) / 1000)) : 0;
  return Math.min(CAP_S, base + run);
}

export const idleDue = (lastInput, now) => now - lastInput >= IDLE_MS;
export const answerLapsed = (promptAt, now) => now - promptAt >= ANSWER_MS;
export const noticeDue = (activeSeconds) => activeSeconds >= CAP_S - NOTICE_LEFT_S;

/**
 * The page shown, for page-turn events: "p12", or an EPUB section and its first character. C38.1 (issue 22, D3): in
 * a scrolled book the place carries `main`, the page with the most area in view (an EPUB's location page, "l42"), so
 * a scroll that leaves it most in view is no turn.
 */
export function pageKey(place) {
  if (!place) return null;
  if (place.kind === 'pdf') return `p${place.main ?? place.pages[0]}`.slice(0, 64);
  return (place.main != null ? `l${place.main}` : `s${place.index}:${place.charStart}`).slice(0, 64);
}

/** Its A4 position (docs/ANCHORS.md): the page or section above a million, the character below. */
export function placePosition(place) {
  if (!place) return null;
  return place.kind === 'pdf' ? place.pages[0] * 1_000_000 : place.index * 1_000_000 + Math.min(place.charStart, 999_999);
}
