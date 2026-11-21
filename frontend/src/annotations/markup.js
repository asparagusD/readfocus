// Edge's markup tools on the page (C39.3, issue 23): which tools a book offers and what the reader is told about the
// one in use. A tool stays on until Escape, a second press on it, or another tool (as in Edge); none on means the
// pointer selects text as before. Pure, so it runs under node --test.
// C39.3 builds the group and Highlight; Draw (C39.4), Erase (C39.5) and Add text (C39.6) join it in their steps.

import { colourName } from './palette.js';

/** Every tool, in Edge's order; `pdf` marks the ones a PDF alone has (D2: an EPUB reflows, so no free ink or boxes). */
export const TOOLS = [
  { id: 'draw', label: 'Draw', menu: 'Draw options', pdf: true }, // C39.4
  { id: 'highlight', label: 'Highlight', menu: 'Highlight colour', pdf: false },
];

/** The tools a book of this kind offers. */
export const toolsFor = (kind) => TOOLS.filter((tool) => kind === 'pdf' || !tool.pdf);

/** The next tool after a press on `pressed`: a second press on the tool in use turns it off. */
export const toggleTool = (current, pressed) => (current === pressed ? null : pressed);

/** What a screen reader hears when a tool turns on or off (`colour` is the highlighter's, `ink` Draw's). */
export function toolStatus(tool, { colour, ink } = {}) {
  if (tool === 'highlight') return `Highlighter on, ${colourName(colour)}. Select text to highlight it. Escape turns it off.`;
  if (tool === 'draw') return `Drawing on, ${colourName(ink.colour)}, ${ink.width} ${ink.width === 1 ? 'point' : 'points'}. Draw on the page. Escape turns it off.`;
  return tool ? '' : 'Markup tools off.';
}
