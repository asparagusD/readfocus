/**
 * What goes onto a notebook page from the book (C37.3, issue 25), pure: each thing as lines of text for Excalidraw
 * text elements, top to bottom. A line is { text, size, font: 'hand' | 'code', muted }. The editor places them
 * below what the page already holds (DrawingEditor `add`). Since typed notes are gone, a passage, a highlight, a
 * Steve answer, a code listing and an equation's LaTeX all come here as words on the page.
 */
import { labelsOf, toBlocks } from '../steve/answer.js';
import { passageLines } from './drawing.js';

const WIDTH = 56; // characters a line, about a third of a 70 % notebook page at 16 px
const BODY = 16;
const SMALL = 14;

const line = (text, extra = {}) => ({ text, size: BODY, font: 'hand', muted: false, ...extra });
const small = (text) => line(text, { size: SMALL, muted: true });
const wrap = (text) => passageLines(text, WIDTH);

/** A passage of the book (N, the selection's Note, a highlight's Note): its reference, then its words. */
export function passageItems(passage, ref = '') {
  const words = wrap(passage);
  return [...(ref ? [small(ref)] : []), ...(words ? [line(words)] : [])];
}

/** answer.js inline segments as plain text: math as $…$, a citation as its label in brackets. */
function plain(segments) {
  return segments.map((s) => {
    if (s.kind === 'math') return s.tex ? `$${s.tex}$` : '';
    if (s.kind === 'cite') return `[${s.label}]`;
    return s.text ?? '';
  }).join('');
}

/** A Steve answer: its heading, its paragraphs and lists wrapped, display math and code as code, then its sources. */
export function answerItems(answer, citations = [], heading = 'Steve') {
  const out = [small(heading)];
  for (const block of toBlocks(answer, labelsOf(citations))) {
    if (block.type === 'code') out.push(line(block.text, { size: SMALL, font: 'code' }));
    else if (block.type === 'math') out.push(line(`$$${block.tex}$$`, { size: SMALL, font: 'code' }));
    else if (block.type === 'list') {
      out.push(line(block.items.map((item, i) => wrap(`${block.ordered ? `${block.start + i}.` : '•'} ${plain(item)}`)).join('\n')));
    } else {
      const words = wrap(plain(block.segments));
      if (words) out.push(line(words));
    }
  }
  const labels = [...new Set(citations.map((c) => c.label).filter(Boolean))];
  if (labels.length) out.push(small(`Sources: ${labels.join(', ')}`));
  return out;
}

/** A code listing, exactly as written, in the code face. */
export const codeItems = (code, ref = '') => [...(ref ? [small(ref)] : []), line(String(code ?? ''), { size: SMALL, font: 'code' })];

/** An equation as its LaTeX, in the code face. */
export const latexItems = (latex, ref = '') => [...(ref ? [small(ref)] : []), line(`$$${String(latex ?? '').trim()}$$`, { size: SMALL, font: 'code' })];
