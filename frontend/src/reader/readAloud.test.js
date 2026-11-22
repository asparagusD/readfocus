import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScript, epubRuns, locate, MAX_UTTERANCE, pdfRuns, wordAt } from './readAloud.js';

const toPoint = (x, y) => [x, 792 - y]; // a Letter page at scale 1: PDF's bottom-left to the top-left
// A text item at (x, top) in top-left points, 10 points high, about 5 points a character.
const item = (str, x, top, extra = {}) => ({ str, transform: [10, 0, 0, 10, x, 792 - top - 10], width: str.length * 5, height: 10, ...extra });
const said = (script) => script.paragraphs.map((p) => p.sentences.map((s) => s.text));

test('a PDF page reads its lines as one paragraph and joins items on a line', () => {
  const runs = pdfRuns(3, [
    item('The quick', 72, 100), item(' ', 117, 100), item('brown fox', 120, 100, { hasEOL: true }),
    item('jumps over.', 72, 112),
  ], toPoint);
  assert.deepEqual(runs.map((r) => [r.str, r.space, r.paraStart]), [
    ['The quick', false, true], ['brown fox', true, false], ['jumps over.', true, false],
  ]);
  assert.deepEqual(runs[2].ref, { page: 3, item: 3 }); // its index among the text items, the space item counted
  assert.deepEqual(said(buildScript(runs)), [['The quick brown fox jumps over.']]);
});

test('items split inside a word join without a space; a gap of a few points makes one', () => {
  const runs = pdfRuns(1, [item('Read', 72, 100), item('Focus', 92, 100), item('app', 120, 100)], toPoint);
  assert.deepEqual(said(buildScript(runs)), [['ReadFocus app']]);
});

test('a big gap or a short line ending a sentence starts a paragraph', () => {
  const wide = 'x'.repeat(90); // reaches 522 points: the column's right edge
  const runs = pdfRuns(1, [
    item(wide, 72, 100), item('End here.', 72, 112), // short, and ends a sentence
    item('Next one', 72, 124), item(wide, 72, 136),
    item('After a gap', 72, 170), // 24 points below a 10-point line
  ], toPoint);
  assert.deepEqual(runs.map((r) => r.paraStart), [true, false, true, false, true]);
  assert.equal(buildScript(runs).paragraphs.length, 3);
});

test('a hyphen at a line end joins the word and is not read', () => {
  const runs = pdfRuns(1, [item('the know-', 72, 100, { hasEOL: true }), item('ledge base', 72, 112)], toPoint);
  const script = buildScript(runs);
  assert.deepEqual(said(script), [['the knowledge base']]);
  assert.deepEqual(wordAt(script.paragraphs[0].sentences[0], 4), [{ run: 0, start: 4, end: 8 }, { run: 1, start: 0, end: 5 }]);
});

test('text inside a skipped region is not read, and the sentence goes on', () => {
  const runs = pdfRuns(1, [item('the value', 72, 100), item('x²+1', 125, 100), item('is small.', 150, 100)], toPoint, [[120, 95, 148, 115]]);
  assert.deepEqual(runs.map((r) => r.skip), [false, true, false]);
  assert.deepEqual(said(buildScript(runs)), [['the value is small.']]);
});

test('an empty page or no items gives an empty script', () => {
  assert.deepEqual(buildScript(pdfRuns(1, [], toPoint)), { paragraphs: [] });
  assert.deepEqual(buildScript(pdfRuns(1, undefined, toPoint)), { paragraphs: [] });
});

const text = (nodeValue) => ({ nodeType: 3, nodeValue });
const el = (localName, ...childNodes) => ({ nodeType: 1, localName, childNodes });

test('an EPUB section reads its blocks as paragraphs and leaves code, math, figures and tables out', () => {
  const body = el('body',
    el('h1', text('Chapter 1')),
    el('p', text('It was '), el('em', text('late')), text('. Then '), el('code', text('x = 1')), text(' ran.')),
    el('pre', text('print(1)')),
    el('figure', el('figcaption', text('Figure 1'))),
    el('p', el('b', text('Bold')), text(' '), el('i', text('start')), text(' here.')));
  const runs = epubRuns(body);
  assert.equal(runs.find((r) => r.str === 'x = 1').skip, true);
  assert.equal(runs.find((r) => r.str === 'Figure 1').skip, true);
  assert.equal(runs[1].ref, body.childNodes[1].childNodes[0]); // the text node itself
  assert.deepEqual(said(buildScript(runs)), [['Chapter 1'], ['It was late.', 'Then ran.'], ['Bold start here.']]);
});

test('whitespace inside a run is read as one space', () => {
  const script = buildScript(epubRuns(el('p', text('  many\n   spaces\there  '))));
  assert.deepEqual(said(script), [['many spaces here']]);
  assert.deepEqual(script.paragraphs[0].sentences[0].map[4], [0, 6]); // the space after "many": the newline
});

test('a paragraph is cut into sentences, and a long sentence at a comma under the limit', () => {
  const long = `Word ${'word '.repeat(29).trim()}, ${'more '.repeat(40).trim()}.`;
  const script = buildScript(epubRuns(el('p', text(`Short one. ${long} Last?`))));
  const [sentences] = said(script);
  assert.equal(sentences[0], 'Short one.');
  assert.ok(sentences.every((s) => s.length <= MAX_UTTERANCE));
  assert.ok(sentences[1].endsWith('word,'));
  assert.equal(sentences.at(-1), 'Last?');
  assert.equal(sentences.join(' '), `Short one. ${long} Last?`);
});

test('every character a sentence speaks maps back to its run and offset', () => {
  const runs = epubRuns(el('p', text('One two. '), el('em', text('Three')), text(' four.')));
  const script = buildScript(runs);
  for (const { sentences } of script.paragraphs) {
    for (const s of sentences) {
      assert.equal(s.map.length, s.text.length);
      [...s.text].forEach((ch, i) => { if (ch !== ' ') assert.equal(runs[s.map[i][0]].str[s.map[i][1]], ch); });
    }
  }
});

test('locate finds where a run and offset are spoken, or the next spoken place', () => {
  const runs = epubRuns(el('div', el('p', text('One two. Three.')), el('pre', text('code')), el('p', text('Four five.'))));
  const script = buildScript(runs);
  assert.deepEqual(locate(script, 0, 0), { p: 0, s: 0, c: 0 });
  assert.deepEqual(locate(script, 0, 9), { p: 0, s: 1, c: 0 }); // "Three."
  assert.deepEqual(locate(script, 0, 3), { p: 0, s: 0, c: 4 }); // the space before "two": the word after it
  assert.deepEqual(locate(script, 1, 2), { p: 1, s: 0, c: 0 }); // inside the skipped code: the next paragraph
  assert.deepEqual(locate(script, 2, 5), { p: 1, s: 0, c: 5 });
  assert.equal(locate(script, 2, 99), null);
});

test('wordAt maps a boundary to the word, with or without its length, from mid-sentence too', () => {
  const runs = epubRuns(el('p', text('Read '), el('em', text('this')), text(' now.')));
  const sentence = buildScript(runs).paragraphs[0].sentences[0];
  assert.deepEqual(wordAt(sentence, 5, 4), [{ run: 1, start: 0, end: 4 }]);
  assert.deepEqual(wordAt(sentence, 5), [{ run: 1, start: 0, end: 4 }]); // no charLength: to the next space
  assert.deepEqual(wordAt(sentence, 0, 4, 10), [{ run: 2, start: 1, end: 5 }]); // spoken from "now."
  assert.deepEqual(wordAt(sentence, 0, 0, 10), [{ run: 2, start: 1, end: 4 }]); // no length: "now", its full stop left out, as a voice gives it
  assert.deepEqual(wordAt(sentence, 50), []);
});
