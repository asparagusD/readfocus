/**
 * The notebook's pages (C37.2, issue 26), pure: one notebook per book, its pages the book's drawing notes in book
 * order (no migration: each drawing row is a page). A page remembers the place it was made (its anchors), so the
 * notebook can open at the page for the place the book shows.
 */
import { overlapping } from './sync.js';

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

/** The open page's save line: the notepad's states in a page's words ('' while it is still being made). */
export function pageStatus(status, pending = false) {
  if (pending) return '';
  if (status === 'conflict' || status === 'error') return 'This page is not saved';
  if (status === 'offline') return 'Offline · kept on this device, saved when you are back';
  if (status === 'saving' || status === 'unsaved') return 'Saving…';
  return 'Saved';
}
