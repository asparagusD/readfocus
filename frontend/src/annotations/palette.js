// The highlight palette (C21.2, handoff screen 18; docs/ANCHORS.md A8): five named colours, never hex. The
// colours themselves are tokens in styles/tokens.css: --hl-<name> behind text, --ul-<name> for a 2 px
// underline, --dot-<name> in the toolbar. Pure, so it runs under node --test.

export const COLOURS = ['honey', 'sage', 'sky', 'rose', 'lilac'];
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

export function storeLastColour(colour, store = globalThis.localStorage) {
  try { store?.setItem(KEY, colour); } catch { /* private mode: the default comes back next time */ }
}

/** The POST /books/{id}/annotations body for a selection `place` ({anchors, start, end}). */
export const newAnnotation = (place, colour, style) => ({
  anchors: place.anchors, style, color: colour, position_start: place.start, position_end: place.end,
});
