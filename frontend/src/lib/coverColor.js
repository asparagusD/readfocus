// D5: a typographic cover's colour is FNV-1a (32-bit) of title + author,
// modulo 5, into the five cover tokens. Title and author are trimmed and
// lower-cased and joined by U+001F, so a change of case or spacing keeps
// the colour. Pure: the same book always gets the same colour.

export const COVER_COLORS = ['moss', 'oxblood', 'ink', 'ochre', 'slate'];

export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function coverColor(title, author) {
  const key = `${(title ?? '').trim().toLowerCase()}\u001f${(author ?? '').trim().toLowerCase()}`;
  return COVER_COLORS[fnv1a(key) % COVER_COLORS.length];
}
