import { compare, placeEnd } from '../originalview/today.js';

/**
 * The book's body start (C23.1, FOCUS_RULES F2) on the reader's side: books.body_start is
 * { kind, page | spine_index, title, anchor }. Pages before it are front matter, where focus mode's
 * stopwatch stays locked (C23.6); the reader can move it with "The book starts here".
 */
const TITLE_SHOWN_MAX = 48;
const TITLE_SENT_MAX = 200;

const startLoc = (start) => {
  if (!start) return null;
  return start.kind === 'pdf' ? { kind: 'pdf', page: start.page } : { kind: 'epub', index: start.spine_index, char: 0 };
};

/** True when every page shown comes before the body start. */
export function beforeBody(place, start) {
  const loc = startLoc(start);
  if (!place || !loc || loc.kind !== place.kind) return false;
  return compare(placeEnd(place), loc) < 0;
}

/** "Chapter 1", or the start entry's own title when it is short ("Part One"). */
export function startLabel(start) {
  const title = start?.title?.trim();
  return title && title.length <= TITLE_SHOWN_MAX ? title : 'Chapter 1';
}

/** The contents entry the body starts at: same PDF page, or same EPUB section. */
export function isStartEntry(entry, start) {
  const loc = startLoc(start);
  if (!loc || entry?.loc?.kind !== loc.kind) return false;
  return loc.kind === 'pdf' ? entry.loc.page === loc.page : entry.loc.index === loc.index;
}

/** The PUT body for "The book starts here": the first page or section shown, and its chapter's title. */
export function chosenStart(place, title) {
  if (!place) return null;
  const named = title?.trim().slice(0, TITLE_SENT_MAX) || null;
  return place.kind === 'pdf' ? { page: place.pages[0], title: named } : { spine_index: place.index, title: named };
}
