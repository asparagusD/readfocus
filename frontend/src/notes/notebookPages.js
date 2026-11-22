/**
 * The notebook's pages (C37.2, issue 26), pure: one notebook per book, its pages the book's drawing notes in book
 * order (no migration: each drawing row is a page). A page remembers the place it was made (its anchors), so the
 * notebook can open at the page for the place the book shows.
 */
import { chapterRange, overlapping } from './sync.js';

/** A note's lasting key: the one `create` gave while it was pending (kept after the server answers), else its id. */
export const pageKey = (note) => note.key ?? note.id;

/** The book's notebook pages: its drawing notes, in the book order the notes already come in. */
export const pagesOf = (notes) => (notes ?? []).filter((n) => n.kind === 'drawing');

/** The key of the page made at the place shown (the last one whose passage meets `range`), or null. */
export function pageHere(pages, range) {
  const here = overlapping(pages, range);
  return here.length ? pageKey(here.at(-1)) : null;
}

/**
 * The page the notebook opens at: the one it was left on, else this place's page, else the last page made before
 * the place, else the first. Null when the notebook has no pages.
 */
export function openingPage(pages, range, last = null) {
  if (!pages.length) return null;
  if (last && pages.some((p) => pageKey(p) === last)) return last;
  const here = pageHere(pages, range);
  if (here) return here;
  const before = range ? pages.filter((p) => p.position_start <= range.start).at(-1) : null;
  return pageKey(before ?? pages[0]);
}

/**
 * C37.3: the page a thing from the book goes onto: the page started last in the same chapter as `start` (an A4
 * position), else null for a new page there. A book without contents counts its PDF page or EPUB section instead.
 */
export function pageFor(pages, start, toc = []) {
  const part = Math.floor(start / 1e6);
  const span = toc?.length ? chapterRange(toc, { start }) : { start: part * 1e6, end: part * 1e6 + 1e6 - 1 };
  const inside = pages.filter((p) => p.position_start >= span.start && p.position_start <= span.end);
  if (!inside.length) return null;
  const latest = inside.reduce((a, b) => (String(b.created_at ?? '') >= String(a.created_at ?? '') ? b : a));
  return pageKey(latest);
}

/** The open page's save line: the notepad's states in a page's words ('' while it is still being made). */
export function pageStatus(status, pending = false) {
  if (pending) return '';
  if (status === 'conflict' || status === 'error') return 'This page is not saved';
  if (status === 'offline') return 'Offline · kept on this device, saved when you are back';
  if (status === 'saving' || status === 'unsaved') return 'Saving…';
  return 'Saved';
}
