// Find in the book (C38.5, issue 22: Edge's Ctrl+F), pure: the pattern a query becomes, the matches in a page's
// text, the order the pages are searched in, stepping between matches, and where a match sits in a page's text items
// (for the view to scroll to it) and in its text layer's text nodes (for the highlight).

const SYNTAX = /[.*+?^${}()|[\]\\]/g;

/**
 * A query as a pattern that ignores case; a space in it matches any run of white space, or none, as a PDF's text
 * often runs one line into the next without a space. Null for a blank query.
 */
export function findPattern(query) {
  const words = (query ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return new RegExp(words.map((word) => word.replace(SYNTAX, '\\$&')).join('\\s*'), 'giu');
}

/** [start, end] of each match of `pattern` in `text`, in order. */
export function matchesIn(text, pattern) {
  if (!pattern || !text) return [];
  return [...text.matchAll(pattern)].filter((m) => m[0].length).map((m) => [m.index, m.index + m[0].length]);
}

/** The pages in the order they are searched: from `from` to the last, then the first up to it (Edge's order). */
export function searchOrder(total, from = 1) {
  const start = Math.min(Math.max(1, from), Math.max(1, total));
  return Array.from({ length: total }, (_, i) => ((start - 1 + i) % total) + 1);
}

/** The match `dir` (1 or -1) along from the one at `index`, round the book's ends; -1 when there are none. */
export function stepMatch(index, count, dir) {
  if (!count) return -1;
  if (index < 0) return dir > 0 ? 0 : count - 1;
  return (index + dir + count) % count;
}

/**
 * Where a match starts, from a page's items packed as [at, x, y, width] (`spots`, scale 1, y the item's top) over
 * text `length` characters long: its item's top, and as far across the item as the match is into its characters.
 */
export function spotOf(spots, length, start) {
  let lo = 0;
  let hi = spots.length / 4 - 1;
  let found = -1;
  while (lo <= hi) { // the last item starting at or before the match
    const mid = (lo + hi) >> 1;
    if (spots[mid * 4] <= start) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return { x: 0, y: 0 };
  const at = spots[found * 4];
  const end = found * 4 + 4 < spots.length ? spots[found * 4 + 4] : length;
  const part = end > at ? (start - at) / (end - at) : 0;
  return { x: spots[found * 4 + 1] + part * spots[found * 4 + 3], y: spots[found * 4 + 2] };
}

/**
 * Where characters `start` to `end` fall in text cut into pieces `lengths` long (a text layer's text nodes):
 * { from: [piece, offset], to: [piece, offset] }, or null past the text's end.
 */
export function locate(lengths, start, end) {
  let at = 0;
  let from = null;
  for (let i = 0; i < lengths.length; i++) {
    const next = at + lengths[i];
    if (!from && start < next) from = [i, start - at];
    if (from && end <= next) return { from, to: [i, end - at] };
    at = next;
  }
  return null;
}

/** What the find bar says: "3 of 47", "No matches", or how many so far while the book is still being searched. */
export function findStatus({ query, count = 0, index = -1, done = false }) {
  if (!query?.trim()) return '';
  if (!done) return count ? `${count} found so far…` : 'Searching…';
  if (!count) return 'No matches';
  return `${index + 1} of ${count}`;
}
