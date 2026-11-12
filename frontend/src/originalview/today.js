// Today's reading inside a whole book (C17.5): where the session's chunks start and end in
// the PDF or EPUB, found by their text until chunks carry source spans (C17.6), and how a
// place in the renderer compares with them. No DOM, so it runs under node --test.
//
// A location is { kind: 'pdf', page } or { kind: 'epub', index, char } (spine section and
// character offset in its body text). A place is what the renderer reports on every move:
// PDF { pages }, EPUB { index, charStart, charEnd }.

/** Text as it is compared: lower case, every whitespace character removed. */
export const squeeze = (text) => (text ?? '').replace(/\s+/g, '').toLowerCase();

/** What to search for to find a chunk: its first 40 characters, then its first 20 (squeezed). */
export function snippetsFor(text) {
  const flat = squeeze(text);
  return [40, 20].filter((n) => flat.length >= n).map((n) => flat.slice(0, n));
}

/** Negative, zero or positive as location a is before, at or after b. */
export function compare(a, b) {
  if (a.kind === 'pdf') return a.page - b.page;
  return a.index - b.index || a.char - b.char;
}

export const placeStart = (place) => (place.kind === 'pdf'
  ? { kind: 'pdf', page: place.pages[0] }
  : { kind: 'epub', index: place.index, char: place.charStart });

export const placeEnd = (place) => (place.kind === 'pdf'
  ? { kind: 'pdf', page: place.pages.at(-1) }
  : { kind: 'epub', index: place.index, char: place.charEnd });

/** True when `at` is on the pages shown (or already behind them). */
export const reached = (place, at) => Boolean(place && at && place.kind === at.kind && compare(placeEnd(place), at) >= 0);

/** True when the pages shown hold `at`. */
export const shows = (place, at) => reached(place, at) && compare(placeStart(place), at) <= 0;

/** True when the pages shown lie wholly before today's start or after today's end. */
export function beyond(place, { start, end } = {}) {
  if (!place) return false;
  if (start && start.kind === place.kind && compare(placeEnd(place), start) < 0) return true;
  return Boolean(end && end.kind === place.kind && compare(placeStart(place), end) > 0);
}

/** The chunk the pages shown begin in: the last of today's located starts at or before them. */
export function chunkAt(place, starts) {
  if (!place || !starts?.length) return null;
  const from = placeStart(place);
  let found = starts[0];
  for (const start of starts) if (start.loc.kind === from.kind && compare(start.loc, from) <= 0) found = start;
  return found.chunk_index;
}

/** "p. 5" from "p. 5 of 6", for the ribbon's toast. */
export const folioShort = (folio) => (folio ?? '').split(' of ')[0];
