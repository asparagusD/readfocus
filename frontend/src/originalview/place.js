// Places in a whole book (C17.5; C26.5b: today's reading and its range are gone): how a place the renderer
// reports compares with a location. No DOM, so it runs under node --test.
//
// A location is { kind: 'pdf', page } or { kind: 'epub', index, char } (spine section and
// character offset in its body text). A place is what the renderer reports on every move:
// PDF { pages }, EPUB { index, charStart, charEnd }.

/** Text as it is compared: lower case, every whitespace character removed. */
export const squeeze = (text) => (text ?? '').replace(/\s+/g, '').toLowerCase();

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

/** "p. 5" from "p. 5 of 6", for the ribbon's toast. */
export const folioShort = (folio) => (folio ?? '').split(' of ')[0];
