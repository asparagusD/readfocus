/**
 * Notes made from the book (C22.6), pure: a highlight as a quote, a Steve answer as a note (citations kept as
 * text), a region's place as an anchor, and a code language the notes API accepts (policy.NOTE_CODE_LANGUAGES).
 */
import { toBlocks, labelsOf } from '../steve/answer.js';
import { pdfPositions } from '../anchors/index.js';

const LANGUAGES = new Set(['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php',
  'swift', 'kotlin', 'scala', 'r', 'matlab', 'julia', 'haskell', 'scheme', 'sql', 'bash', 'html', 'css', 'json', 'yaml',
  'xml', 'latex', 'text']);
const ALIASES = { py: 'python', js: 'javascript', ts: 'typescript', 'c++': 'cpp', 'c#': 'csharp', sh: 'bash', shell: 'bash',
  tex: 'latex', golang: 'go', rs: 'rust', rb: 'ruby', kt: 'kotlin', plaintext: 'text' };
const ANCHOR_TEXT_MAX = 2000;

const collapse = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const text = (value, marks) => (value ? [{ type: 'text', text: value, ...(marks?.length ? { marks } : {}) }] : []);
const paragraph = (content) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });

/** A region's language guess as one the notes API knows, or ''. */
export function noteLanguage(guess) {
  const key = String(guess ?? '').trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  return LANGUAGES.has(name) ? name : '';
}

/** A highlight's passage as a quote, then an empty paragraph to write in. */
export function quoteDoc(passage) {
  const quote = collapse(passage);
  return { type: 'doc', content: [...(quote ? [{ type: 'blockquote', content: [paragraph(text(quote))] }] : []), { type: 'paragraph' }] };
}

/** answer.js inline segments as TipTap inline nodes; a citation stays as its label in brackets. */
function inlineNodes(segments) {
  return segments.flatMap((s) => {
    if (s.kind === 'math') return s.tex ? [{ type: 'inlineMath', attrs: { latex: s.tex } }] : [];
    if (s.kind === 'code') return text(s.text, [{ type: 'code' }]);
    if (s.kind === 'strong') return text(s.text, [{ type: 'bold' }]);
    if (s.kind === 'em') return text(s.text, [{ type: 'italic' }]);
    if (s.kind === 'cite') return text(`[${s.label}]`);
    return text(s.text);
  });
}

/** Neighbouring text nodes with the same marks joined, so "[p. 2]" reads as one with the sentence around it. */
function joined(nodes) {
  const out = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (node.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(node.marks)) {
      out[out.length - 1] = { ...last, text: last.text + node.text };
    } else out.push(node);
  }
  return out;
}

/**
 * A Steve answer as a text note: "Steve · from page 2" in italics, the answer's paragraphs, lists, display math and
 * code (each line in code marks, lines joined by breaks: notes have no code blocks), then "Sources: p. 2, p. 5".
 */
export function answerDoc(answer, citations = [], heading = 'Steve') {
  const blocks = toBlocks(answer, labelsOf(citations));
  const content = [paragraph(text(heading, [{ type: 'italic' }]))];
  for (const block of blocks) {
    if (block.type === 'math') content.push({ type: 'blockMath', attrs: { latex: block.tex } });
    else if (block.type === 'code') {
      const lines = block.text.split('\n').flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...text(line, [{ type: 'code' }])]);
      content.push(paragraph(lines));
    } else if (block.type === 'list') {
      content.push({ type: block.ordered ? 'orderedList' : 'bulletList', ...(block.ordered && block.start > 1 ? { attrs: { start: block.start } } : {}),
        content: block.items.map((item) => ({ type: 'listItem', content: [paragraph(joined(inlineNodes(item)))] })) });
    } else content.push(paragraph(joined(inlineNodes(block.segments))));
  }
  const labels = [...new Set(citations.map((c) => c.label).filter(Boolean))];
  if (labels.length) content.push(paragraph(text(`Sources: ${labels.join(', ')}`, [{ type: 'italic' }])));
  return { type: 'doc', content };
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
