// EPUB highlights and underlines (C21.3): the CSS Custom Highlight API inside each section's document, so the
// book's markup is never changed and a re-layout (text size, window, margins) moves the marks with their words.
// The lookup mark (reader/highlight.js, 'rf-lookup', priority 0) is painted over these (priority -1).
import { COLOURS } from './palette.js';
import { forSpine, highlightCss, highlightName } from './paint.js';

const STYLE = 'data-rf-annotations';
const NAMES = COLOURS.flatMap((c) => [`rf-highlight-${c}`, `rf-underline-${c}`]);

/** Each colour's highlight and underline as this page shows them: Paper's on a light page, the theme's otherwise. */
export function readPalette(dark) {
  const probe = document.createElement('span');
  if (!dark) probe.dataset.theme = 'paper'; // tokens.css gives this subtree Paper's colours
  probe.hidden = true;
  document.body.append(probe);
  const css = getComputedStyle(probe);
  const read = (prefix) => Object.fromEntries(COLOURS.map((c) => [c, css.getPropertyValue(`--${prefix}-${c}`).trim()]));
  const palette = { hl: read('hl'), ul: read('ul') };
  probe.remove();
  return palette;
}

/**
 * Paint `annotations` that lie in shown section `index` into its document `doc`, replacing what was painted
 * there before. `rangeFor(doc, cfi)` resolves a CFI to a range (engine.js).
 */
export function paintSection(doc, index, annotations, rangeFor, palette) {
  const win = doc?.defaultView;
  if (!win?.CSS?.highlights || typeof win.Highlight !== 'function') return;
  for (const name of NAMES) win.CSS.highlights.delete(name);
  const groups = new Map();
  for (const a of forSpine(annotations, index)) {
    for (const anchor of a.anchors) {
      const range = anchor.kind === 'epub' ? rangeFor(doc, anchor.cfi) : null;
      if (!range || range.collapsed) continue; // not this section's, or not found (orphans: C21.5)
      const name = highlightName(a);
      groups.set(name, [...(groups.get(name) ?? []), range]);
    }
  }
  for (const [name, ranges] of groups) {
    const highlight = new win.Highlight(...ranges);
    highlight.priority = -1;
    win.CSS.highlights.set(name, highlight);
  }
  let style = doc.head?.querySelector(`style[${STYLE}]`);
  if (!style) {
    style = doc.createElement('style');
    style.setAttribute(STYLE, '');
    doc.head?.append(style);
  }
  style.textContent = highlightCss(palette);
}
