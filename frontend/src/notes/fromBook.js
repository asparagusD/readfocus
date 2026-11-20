/**
 * Notes made from the book (C22.6), pure: a region's place as an anchor, and a code language the notes API accepts
 * (policy.NOTE_CODE_LANGUAGES). C37.4: a highlight's quote and a Steve answer as typed notes are gone with typed
 * notes; notebookItems.js writes them on a notebook page.
 */
import { pdfPositions } from '../anchors/index.js';

const LANGUAGES = new Set(['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php',
  'swift', 'kotlin', 'scala', 'r', 'matlab', 'julia', 'haskell', 'scheme', 'sql', 'bash', 'html', 'css', 'json', 'yaml',
  'xml', 'latex', 'text']);
const ALIASES = { py: 'python', js: 'javascript', ts: 'typescript', 'c++': 'cpp', 'c#': 'csharp', sh: 'bash', shell: 'bash',
  tex: 'latex', golang: 'go', rs: 'rust', rb: 'ruby', kt: 'kotlin', plaintext: 'text' };
const ANCHOR_TEXT_MAX = 2000;

const collapse = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** A region's language guess as one the notes API knows, or ''. */
export function noteLanguage(guess) {
  const key = String(guess ?? '').trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  return LANGUAGES.has(name) ? name : '';
}

/**
 * Where a PDF region's note goes: its box as one quad on its page, with the region's text (collapsed, capped) as a
 * selection, or the view scope when it has no text. `pageWidth` in points, for the A4 positions.
 */
export function regionPlace(region, pageWidth, regionText) {
  const words = collapse(regionText).slice(0, ANCHOR_TEXT_MAX);
  const anchors = [{ kind: 'pdf', page: region.page, quads: [region.bbox.map((v) => Math.round(v * 100) / 100)], text: words }];
  return { scope: words ? 'selection' : 'view', anchors, ...pdfPositions(anchors, [pageWidth]) };
}
