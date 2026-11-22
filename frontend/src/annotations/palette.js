// The highlight palette (C21.2, handoff screen 18; docs/ANCHORS.md A8): named colours, never hex. The
// colours themselves are tokens in styles/tokens.css: --hl-<name> behind text, --ul-<name> for a 2 px
// underline, --dot-<name> in the toolbar. Pure, so it runs under node --test.
// C39.2 (issue 23, D3): Edge's set. The handoff's five come first and are always shown; the other five (Edge's
// red and the deeper yellow, green, blue and pink) open with More colours. The server checks the same list.

export const COLOURS = ['honey', 'sage', 'sky', 'rose', 'lilac', 'poppy', 'amber', 'fern', 'ocean', 'berry'];
export const FIRST_COLOURS = COLOURS.slice(0, 5);
export const MORE_COLOURS = COLOURS.slice(5);
/** C39.2: ink and text-box colours (tokens --mark-<name>), for C39.4's Draw and C39.6's Add text. */
export const MARK_COLOURS = ['ink', 'poppy', 'amber', 'fern', 'ocean', 'berry', 'plum'];
const KEY = 'rf-highlight-colour';

export const colourName = (colour) => colour.charAt(0).toUpperCase() + colour.slice(1);

/** The colour H and U use: the last one picked on this device, honey until then. */
export function lastColour(store = globalThis.localStorage) {
  try {
    const stored = store?.getItem(KEY);
    return COLOURS.includes(stored) ? stored : 'honey';
  } catch {
    return 'honey';
  }
}

/** C39.3: said on the window when the last colour changes, so the toolbar's highlighter shows it at once. */
export const COLOUR_EVENT = 'rf-highlight-colour';

export function storeLastColour(colour, store = globalThis.localStorage) {
  try { store?.setItem(KEY, colour); } catch { /* private mode: the default comes back next time */ }
  if (typeof globalThis.dispatchEvent === 'function') globalThis.dispatchEvent(new CustomEvent(COLOUR_EVENT, { detail: colour }));
}

/** The POST /books/{id}/annotations body for a selection `place` ({anchors, start, end}). */
export const newAnnotation = (place, colour, style, comment = null) => ({
  anchors: place.anchors, style, color: colour, position_start: place.start, position_end: place.end,
  ...(comment && { comment }), // C39.8 (issue 23, D1): Edge's Add comment on a highlight
});

/** C39.8: a comment as the server keeps it: trimmed, at most 1,000 characters; empty is none (null). */
export const COMMENT_MAX = 1_000;
export const cleanComment = (text) => (text ?? '').trim().slice(0, COMMENT_MAX) || null;

/** The colours a book's annotations use, in palette order (the Annotations tab filters by these). */
export const coloursUsed = (annotations) => COLOURS.filter((c) => annotations.some((a) => a.color === c));
