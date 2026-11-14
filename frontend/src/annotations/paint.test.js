import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forPages, forSpine, highlightCss, highlightName, pdfBoxes } from './paint.js';

const pdf = (id, page, quads, style = 'highlight', color = 'honey') => ({ id, style, color, anchors: [{ kind: 'pdf', page, quads, text: 'x' }] });
const across = { id: 'a3', style: 'underline', color: 'sky', anchors: [
  { kind: 'pdf', page: 4, quads: [[72, 700, 300, 712]], text: 'end of' }, { kind: 'pdf', page: 5, quads: [[72, 60, 120, 72]], text: 'four' }] };
const epub = (id, cfi) => ({ id, style: 'highlight', color: 'rose', anchors: [{ kind: 'epub', cfi, text: 'x' }] });

test('only annotations on the pages shown, and one either side, are drawn', () => {
  const list = [pdf('a1', 1, [[0, 0, 1, 1]]), pdf('a2', 9, [[0, 0, 1, 1]]), across, pdf('a4', 3, [[0, 0, 1, 1]])];
  assert.deepEqual(forPages(list, [2, 3]).map((a) => a.id), ['a1', 'a3', 'a4']); // pages 1-4
  assert.deepEqual(forPages(list, [6]).map((a) => a.id), ['a3']); // its second page is p. 5
  assert.deepEqual(forPages(list, []), []);
});

test('a page draws a box per quad in CSS px at its scale; an underline is a 2 px bar under the line', () => {
  const boxes = pdfBoxes([pdf('a1', 2, [[72, 100, 300, 112], [72, 114, 150.5, 126]]), across, pdf('a5', 5, [[10, 10, 20, 20]], 'underline', 'lilac')], 5, 1.5);
  assert.deepEqual(boxes, [
    { key: 'a3:0', style: 'underline', color: 'sky', left: 108, top: 108, width: 72, height: 2 },
    { key: 'a5:0', style: 'underline', color: 'lilac', left: 15, top: 30, width: 15, height: 2 },
  ]);
  assert.deepEqual(pdfBoxes([pdf('a1', 2, [[72, 100, 300, 112]])], 2, 2), [
    { key: 'a1:0', style: 'highlight', color: 'honey', left: 144, top: 200, width: 456, height: 24 },
  ]);
});

test('an EPUB section draws the annotations whose CFI is in it', () => {
  const list = [epub('e1', 'epubcfi(/6/4!/4/2,/1:0,/1:9)'), epub('e2', 'epubcfi(/6/6!/4/2,/1:0,/1:9)'), pdf('p', 1, [[0, 0, 1, 1]])];
  assert.deepEqual(forSpine(list, 1).map((a) => a.id), ['e1']);
  assert.deepEqual(forSpine(list, 2).map((a) => a.id), ['e2']);
  assert.deepEqual(forSpine(list, 0), []);
});

test('the section rules paint highlights behind the text and underlines in the same hue, 2 px', () => {
  assert.equal(highlightName({ style: 'underline', color: 'sky' }), 'rf-underline-sky');
  const css = highlightCss({ hl: { honey: '#f4e2a8' }, ul: { honey: '#988137' } });
  assert.match(css, /::highlight\(rf-highlight-honey\) \{ background-color: #f4e2a8; \}/);
  assert.match(css, /::highlight\(rf-underline-honey\) \{ text-decoration: underline 2px #988137; \}/);
});
