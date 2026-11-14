/**
 * Where a note sits in the book (C22.2): its chapter from the book's contents, its reference line
 * ("p. 45 · Fourier series") and book order. Positions are ANCHORS A4: page or spine index * 1e6 + the rest.
 */

const PART = 1e6;

/** A contents entry's A4 position: a PDF page's top, or an EPUB section's start plus its character. */
const tocPosition = (loc) => (loc?.kind === 'epub' ? (loc.index ?? 0) * PART + (loc.char ?? 0) : (loc?.page ?? 0) * PART);

/** The title of the last contents entry at or before the note's start, or ''. */
export function chapterOf(note, toc) {
  let title = '';
  let best = -1;
  for (const entry of toc ?? []) {
    const at = tocPosition(entry.loc);
    if (at <= note.position_start && at >= best) { best = at; title = entry.title; }
  }
  return title;
}

export function reference(page, chapter) {
  return [page, chapter].filter(Boolean).join(' · ') || 'This book';
}

/** Book order (A4), then oldest first among notes on the same spot. */
export function inBookOrder(notes) {
  return [...notes].sort((a, b) => a.position_start - b.position_start || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
}
