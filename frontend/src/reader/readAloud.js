/**
 * Read aloud's text (C40.1, issue 24): what the voice says, built from a PDF page's text items or an EPUB section's
 * text nodes, and the way back from a spoken word to the text it came from, so the page can mark it.
 *
 * Both books become runs: { str, ref, space, paraStart, skip }: a piece of text, what it points at (a PDF page and
 * its text item's index, or an EPUB text node), whether a space goes before it, whether a paragraph starts with it,
 * and whether it is left unread (math, code, figures and tables, as Look up leaves them). A script is the runs'
 * paragraphs, each cut into sentences of at most MAX_UTTERANCE characters (Chromium cuts a long utterance off), and
 * each sentence keeps, for every character it speaks, the run and offset it came from.
 */
export const MAX_UTTERANCE = 240;
const TERMINAL = /[.!?:;'"’”)\]]$/;

/** A text item's box in page points from the top-left (ANCHORS A1), through `toPoint` (a scale-1 viewport's convertToViewportPoint). */
function itemBox(item, toPoint) {
  const [x, y] = toPoint(item.transform[4], item.transform[5]);
  const size = Math.hypot(item.transform[2], item.transform[3]) || item.height || 0;
  return [x, y - size, x + (item.width || 0), y];
}

const inside = ([x0, top, x1, bottom]) => (b) => {
  const cx = (x0 + x1) / 2;
  const cy = (top + bottom) / 2;
  return cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3];
};

/**
 * A PDF page's runs from getTextContent()'s items. `ref` is { page, item }: the item's index among the text items
 * (marked-content entries left out), which is its span's index in PDF.js's text layer. A paragraph starts where the
 * gap above a line is more than 1.4 lines, or after a line that ends a sentence well short of the column's edge.
 * `skip` is the page's region boxes (math, code, figures, tables) in the same points.
 */
export function pdfRuns(page, items, toPoint, skip = []) {
  const texts = (items ?? []).filter((item) => typeof item.str === 'string');
  const boxes = texts.map((item) => itemBox(item, toPoint));
  const right = Math.max(0, ...boxes.map((b) => b[2]));
  const runs = [];
  let line = null; // { top, bottom, end, text } of the line being read
  texts.forEach((item, i) => {
    const box = boxes[i];
    if (!item.str.trim()) { // a space item: it only says a space comes next
      if (runs.length && line) line.spaced = true;
      if (item.hasEOL) line = line && { ...line, closed: true };
      return;
    }
    const height = box[3] - box[1] || 1;
    const newLine = !line || line.closed || box[1] >= line.bottom - height * 0.3;
    let space = false;
    let paraStart = !line;
    if (line && newLine) {
      const gap = box[1] - line.bottom;
      const short = line.end < right - height * 4 && TERMINAL.test(line.text);
      paraStart = gap > height * 1.4 || short;
      space = !/-$/.test(line.text); // a hyphen at a line's end joins the word across it
    } else if (line) {
      space = line.spaced || box[0] - line.end > height * 0.15;
    }
    runs.push({ str: item.str, ref: { page, item: i }, space, paraStart, skip: skip.some(inside(box)) });
    line = {
      top: newLine ? box[1] : Math.min(line.top, box[1]),
      bottom: newLine ? box[3] : Math.max(line.bottom, box[3]),
      end: box[2],
      text: item.str.trimEnd(),
      spaced: /\s$/.test(item.str),
      closed: Boolean(item.hasEOL),
    };
  });
  return runs;
}

const BLOCKS = new Set(['p', 'div', 'li', 'dt', 'dd', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section',
  'article', 'aside', 'header', 'footer', 'figcaption', 'caption', 'br', 'hr', 'ul', 'ol', 'dl', 'nav', 'main']);
const UNREAD = new Set(['pre', 'code', 'math', 'figure', 'table', 'svg', 'script', 'style', 'noscript', 'img', 'rt']);

/**
 * An EPUB section's runs: its text nodes in document order, `ref` the node. Text inside pre, code, math, figures,
 * tables and SVG is left out (`skip`); a block element (p, li, a heading) starts a paragraph. Works on anything
 * with nodeType, nodeValue, localName and childNodes, so a test needs no DOM.
 */
export function epubRuns(root) {
  const runs = [];
  let paraNext = true;
  const walk = (node, skipped) => {
    if (node.nodeType === 3) {
      const str = node.nodeValue ?? '';
      if (!str.trim()) { if (runs.length && !paraNext) runs.at(-1).trailingSpace = true; return; }
      const prev = runs.at(-1);
      runs.push({ str, ref: node, space: Boolean(prev && !paraNext && (prev.trailingSpace || /^\s/.test(str))),
        paraStart: paraNext, skip: skipped });
      paraNext = false;
      return;
    }
    if (node.nodeType !== 1) return;
    const name = (node.localName ?? '').toLowerCase();
    const block = BLOCKS.has(name);
    if (block) paraNext = true;
    for (const child of node.childNodes ?? []) walk(child, skipped || UNREAD.has(name));
    if (block) paraNext = true;
  };
  walk(root, false);
  for (const run of runs) delete run.trailingSpace;
  return runs;
}

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Cuts a sentence longer than MAX_UTTERANCE at its last comma, semicolon or space before the limit. */
function cutLong(from, to, text) {
  const pieces = [];
  let at = from;
  while (to - at > MAX_UTTERANCE) {
    const window = text.slice(at, at + MAX_UTTERANCE);
    const stop = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '));
    const cut = stop > MAX_UTTERANCE / 3 ? stop + 2 : (window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') + 1 : MAX_UTTERANCE);
    pieces.push([at, at + cut]);
    at += cut;
  }
  pieces.push([at, to]);
  return pieces;
}

/**
 * The script for `runs`: { paragraphs: [{ sentences: [{ text, map }] }] }, where map[i] is [run index, offset] of
 * the sentence's i-th character (a space put between runs maps to the next run's start). Whitespace inside a run is
 * read as one space; a hyphen that joins a word across lines is not read. Skipped runs end a sentence's words but
 * not its paragraph, so "the value $x$ is" reads as "the value is".
 */
export function buildScript(runs) {
  const paragraphs = [];
  let text = '';
  let map = [];
  const flush = () => {
    const end = text.trimEnd().length;
    if (end) {
      const sentences = [];
      for (const { index, segment } of sentenceSegmenter.segment(text.slice(0, end))) {
        const start = index + (segment.length - segment.trimStart().length);
        const stop = index + segment.trimEnd().length;
        if (stop > start) {
          for (const [a, b] of cutLong(start, stop, text)) {
            const lead = text.slice(a, b).length - text.slice(a, b).trimStart().length;
            const piece = text.slice(a + lead, b).trimEnd();
            if (piece) sentences.push({ text: piece, map: map.slice(a + lead, a + lead + piece.length) });
          }
        }
      }
      if (sentences.length) paragraphs.push({ sentences });
    }
    text = '';
    map = [];
  };
  runs.forEach((run, r) => {
    if (run.paraStart) flush();
    if (run.skip) return;
    const { str } = run;
    if (!run.space && /\S-$/.test(text) && /^[a-z]/.test(str)) { text = text.slice(0, -1); map.pop(); } // "know-|ledge"
    if (text && (run.space || /^\s/.test(str)) && !/\s$/.test(text)) { text += ' '; map.push([r, 0]); }
    for (let i = 0; i < str.length; i += 1) {
      if (/\s/.test(str[i])) {
        if (!text || /\s$/.test(text)) continue;
        text += ' ';
      } else text += str[i];
      map.push([r, i]);
    }
  });
  flush();
  return { paragraphs };
}

/** Where run `run` at `offset` is spoken: { p, s, c } (paragraph, sentence, character), or the next spoken place after it; null past the end. */
export function locate(script, run, offset = 0) {
  for (let p = 0; p < script.paragraphs.length; p += 1) {
    const { sentences } = script.paragraphs[p];
    for (let s = 0; s < sentences.length; s += 1) {
      const c = sentences[s].map.findIndex(([r, o]) => r > run || (r === run && o >= offset));
      if (c >= 0) return { p, s, c: sentences[s].text[c] === ' ' ? c + 1 : c };
    }
  }
  return null;
}

/**
 * The word a boundary event names, as ranges of runs: [{ run, start, end }] (end exclusive). `from` is where the
 * utterance began in the sentence (it may start mid-sentence, from a selection); `charLength` is Chromium's, else
 * the word runs to the next space.
 */
export function wordAt(sentence, charIndex, charLength = 0, from = 0) {
  const start = from + charIndex;
  if (start >= sentence.text.length) return [];
  let end = charLength > 0 ? start + charLength : sentence.text.indexOf(' ', start);
  if (end < 0 || end > sentence.text.length) end = sentence.text.length;
  const ranges = [];
  for (let i = start; i < end; i += 1) {
    if (sentence.text[i] === ' ') continue;
    const [run, offset] = sentence.map[i];
    const last = ranges.at(-1);
    if (last && last.run === run && last.end === offset) last.end = offset + 1;
    else ranges.push({ run, start: offset, end: offset + 1 });
  }
  return ranges;
}
