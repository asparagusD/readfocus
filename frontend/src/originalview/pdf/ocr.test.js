import test from 'node:test';
import assert from 'node:assert/strict';
import { ocrScale, skipBoxes, toPayload, spansFor } from './ocr.js';

test('pages are read at about 300 dpi, never past the pixel cap', () => {
  assert.equal(ocrScale(612, 792), 2400 / 792); // a Letter page: the cap bites first
  assert.equal(ocrScale(200, 100), 300 / 72);
});

test('math, code, table and figure boxes are skipped, but not the scan itself', () => {
  const page = [0, 0, 600, 800];
  assert.deepEqual(skipBoxes([page, [10, 10, 50, 30], [0, 0, 600, 700]], 600, 800), [[10, 10, 50, 30]]);
});

test('tesseract blocks become words in page points with paragraph and line numbers', () => {
  const scale = 2;
  const blocks = [{ paragraphs: [
    { lines: [
      { words: [{ text: 'The', confidence: 96.4, bbox: { x0: 144, y0: 144, x1: 200, y1: 168 } },
        { text: 'lamp.', confidence: 91, bbox: { x0: 210, y0: 144, x1: 290, y1: 168 } }] },
      { words: [{ text: 'Next', confidence: 88, bbox: { x0: 144, y0: 180, x1: 210, y1: 204 } }] },
    ] },
    { lines: [{ words: [{ text: ' ', confidence: 10, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }] }] },
  ] }];
  assert.deepEqual(toPayload(blocks, scale), [
    { t: 'The', b: [72, 72, 100, 84], c: 96.4, p: 0, l: 0 },
    { t: 'lamp.', b: [105, 72, 145, 84], c: 91, p: 0, l: 0 },
    { t: 'Next', b: [72, 90, 105, 102], c: 88, p: 0, l: 1 },
  ]);
  assert.deepEqual(toPayload(null, scale), []);
});

test('stored words become text layer spans in CSS pixels, with a space between words of a line', () => {
  const words = [{ t: 'The', b: [72, 72, 100, 84] }, { t: 'lamp.', b: [105, 72, 145, 84] }, { t: 'Next', b: [72, 90, 105, 102] }];
  assert.deepEqual(spansFor(words, 1.5), [
    { text: 'The ', left: 108, top: 108, width: 49.5, height: 18 },
    { text: 'lamp.', left: 157.5, top: 108, width: 60, height: 18 },
    { text: 'Next', left: 108, top: 135, width: 49.5, height: 18 },
  ]);
});
