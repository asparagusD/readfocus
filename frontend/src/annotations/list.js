// The Annotations tab (C21.5), pure: the list in reading order with a colour filter, a PDF annotation's page label
// and the snippet shown for each.

const SNIPPET = 140;

/** `annotations` in reading order (A4 positions), only `colour`'s when one is given; the input is not changed. */
export const listed = (annotations, colour) => annotations
  .filter((a) => !colour || a.color === colour)
  .sort((a, b) => a.position_start - b.position_start);

/** "p. 1" or "pp. 1–2" from the printed page labels (`labels[n - 1]`) when the PDF has them; '' for an EPUB. */
export function pdfPagesLabel(annotation, labels) {
  const pages = annotation.anchors.filter((a) => a.kind === 'pdf').map((a) => a.page);
  if (!pages.length) return '';
  const name = (n) => labels?.[n - 1] ?? String(n);
  const [first, last] = [pages[0], pages.at(-1)];
  return first === last ? `p. ${name(first)}` : `pp. ${name(first)}–${name(last)}`;
}

/** The passage as saved (a pending one from its anchors), whitespace collapsed, cut at a word. */
export function snippetOf(annotation, max = SNIPPET) {
  const text = (annotation.text_snapshot ?? annotation.anchors.map((a) => a.text).join(' ')).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length)}…`;
}
