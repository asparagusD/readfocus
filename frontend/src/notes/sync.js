/**
 * Book <-> notepad sync (C22.5, PROGRESS D9), pure. Ranges are ANCHORS A4 positions, so they do not change with
 * zoom, text size or re-pagination: only which range is shown does, and the notes follow it.
 */
import { inBookOrder, tocPosition } from './place.js';

const PART = 1e6;
const HOLD_AFTER_JUMP = 1500; // ms: the move the notepad asked for does not scroll it away
const HOLD_AFTER_HAND = 2000; // ms: a reader who just scrolled the notepad is not scrolled for

/** The A4 range of the place shown: whole PDF pages, or an EPUB page's characters in its spine item. */
export function shownRange(place) {
  if (place?.kind === 'pdf' && place.pages?.length) return { start: place.pages[0] * PART, end: place.pages.at(-1) * PART + PART - 1 };
  if (place?.kind === 'epub' && Number.isFinite(place.index) && Number.isFinite(place.charStart)) {
    return { start: place.index * PART + place.charStart, end: place.index * PART + Math.max(place.charStart, place.charEnd ?? place.charStart) };
  }
  return null;
}

/** Notes whose range meets `range`, in book order (then oldest first on one spot). */
export function overlapping(notes, range) {
  if (!range) return [];
  return inBookOrder(notes.filter((n) => n.position_start <= range.end && (n.position_end ?? n.position_start) >= range.start));
}

/** The contents entry holding the range's start, from its position to just before the next entry's. */
export function chapterRange(toc, range) {
  const starts = (toc ?? []).map((e) => ({ at: tocPosition(e.loc), title: e.title })).sort((a, b) => a.at - b.at);
  let i = -1;
  starts.forEach((s, k) => { if (s.at <= (range?.start ?? 0)) i = k; });
  if (i < 0) return { start: 0, end: starts.length ? starts[0].at - 1 : Infinity, title: '' };
  return { start: starts[i].at, end: i + 1 < starts.length ? starts[i + 1].at - 1 : Infinity, title: starts[i].title };
}

/** The notes the filter shows: 'page', 'chapter' or 'all'; everything until a place is known. */
export function notesFor(notes, filter, range, toc) {
  if (!range || filter === 'all') return inBookOrder(notes);
  return overlapping(notes, filter === 'page' ? range : chapterRange(toc, range));
}

/**
 * What the notepad does when the book moves: 'scroll' to the first note shown, 'pill' (offer "Jump to notes for
 * this page") while a note is being written or just after the reader scrolled the list, or 'none' (nothing on these
 * pages, or the move came from the notepad's own jump).
 */
export function followAction({ hasTarget, typing, now, jumpAt = -Infinity, handAt = -Infinity }) {
  if (!hasTarget || now - jumpAt < HOLD_AFTER_JUMP) return 'none';
  if (typing || now - handAt < HOLD_AFTER_HAND) return 'pill';
  return 'scroll';
}
