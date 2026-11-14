import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockForCfi, compareAnchors, compareCfi, epubAnchor, epubPositions, parseCfi, pdfAnchor, pdfPosition, pdfPositions, quadsFromRects, rectsFromQuads, textOf,
} from './index.js';

// A US Letter page (612 x 792 pt) drawn at `scale` CSS px per point, its top-left at (100, 50) on screen.
const page = { left: 100, top: 50 };
/** The screen rects of two lines of a selection on that page at `scale`; PDF.js gives a rect per glyph run. */
const lineRects = (scale) => [
  { left: 100 + 72 * scale, top: 50 + 92 * scale, right: 100 + 150 * scale, bottom: 50 + 104 * scale },
  { left: 100 + 151 * scale, top: 50 + 92.5 * scale, right: 100 + 300 * scale, bottom: 50 + 104 * scale }, // same line
  { left: 100 + 72 * scale, top: 50 + 110 * scale, right: 100 + 200 * scale, bottom: 50 + 122 * scale },
];

test('a PDF selection becomes one quad per line in points from the top-left, the same at 100% and 200%', () => {
  const at100 = quadsFromRects(lineRects(96 / 72), page, 96 / 72);
  const at200 = quadsFromRects(lineRects((96 / 72) * 2), page, (96 / 72) * 2);
  assert.deepEqual(at100, [[72, 92, 300, 104], [72, 110, 200, 122]]);
  assert.deepEqual(at200, at100);
});

test('quads draw back onto the page at any zoom', () => {
  const quads = [[72, 92, 300, 104]];
  assert.deepEqual(rectsFromQuads(quads, page, 2), [{ left: 244, top: 234, width: 456, height: 24 }]);
  const round = quadsFromRects(rectsFromQuads(quads, page, 3).map((r) => ({ ...r, right: r.left + r.width, bottom: r.top + r.height })), page, 3);
  assert.deepEqual(round, quads);
});

test('anchors have the ANCHORS.md A1 shapes, text collapsed and empty only for a point', () => {
  assert.equal(textOf('  The lamp\n threw  a\tcircle. '), 'The lamp threw a circle.');
  assert.deepEqual(pdfAnchor(5, [[72, 92, 300, 104]], ' a  lamp '), { kind: 'pdf', page: 5, quads: [[72, 92, 300, 104]], text: 'a lamp' });
  assert.deepEqual(pdfAnchor(5, [], ''), { kind: 'pdf', page: 5, quads: [[0, 0, 0, 0]], text: '' });
  assert.deepEqual(epubAnchor('epubcfi(/6/4!/4/2,/1:0,/1:4)', 'Chap\nter'), { kind: 'epub', cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:4)', text: 'Chap ter' });
});

test('a CFI parses to its spine index, element steps and offset (a range to its start)', () => {
  assert.deepEqual(parseCfi('epubcfi(/6/4!/4/2/1:0)'), { spine: 1, steps: [4, 2, 1], offset: 0 });
  assert.deepEqual(parseCfi('epubcfi(/6/8[ch3]!/4[body]/10,/1:5,/3:2)'), { spine: 3, steps: [4, 10, 1], offset: 5 });
  assert.equal(parseCfi('not a cfi'), null);
});

test('positions order across pages and sections', () => {
  assert.equal(pdfPosition({ kind: 'pdf', page: 3, quads: [[306, 100.7, 400, 112]] }, 612), 3 * 1e6 + 100 * 1e2 + 49);
  const pdf = [
    { kind: 'pdf', page: 4, quads: [[72, 50, 90, 60]] },
    { kind: 'pdf', page: 3, quads: [[300, 500, 320, 510]] },
    { kind: 'pdf', page: 3, quads: [[72, 500, 90, 510]] },
    { kind: 'pdf', page: 3, quads: [[72, 90, 90, 100]] },
  ];
  assert.deepEqual([...pdf].sort(compareAnchors).map((a) => `${a.page}:${a.quads[0][1]}:${a.quads[0][0]}`),
    ['3:90:72', '3:500:72', '3:500:300', '4:50:72']);
  const cfis = ['epubcfi(/6/6!/4/2/1:0)', 'epubcfi(/6/4!/4/10/1:3)', 'epubcfi(/6/4!/4/4/1:20)', 'epubcfi(/6/4!/4/4/1:5)', 'epubcfi(/6/4!/4/4/3:0)'];
  assert.deepEqual([...cfis].sort(compareCfi),
    ['epubcfi(/6/4!/4/4/1:5)', 'epubcfi(/6/4!/4/4/1:20)', 'epubcfi(/6/4!/4/4/3:0)', 'epubcfi(/6/4!/4/10/1:3)', 'epubcfi(/6/6!/4/2/1:0)']);
});

test("a CFI maps to the C12 block whose element holds it, else the last block before it in its section", () => {
  const paths = [
    { chunk_index: 0, block_id: '0.0', spine_index: 1, path: '/4/2' },
    { chunk_index: 0, block_id: '0.1', spine_index: 1, path: '/4/4' },
    { chunk_index: 0, block_id: '0.2', spine_index: 1, path: '/4/6/4' },
    { chunk_index: 1, block_id: '1.0', spine_index: 2, path: '/4/2' },
  ];
  assert.deepEqual(blockForCfi('epubcfi(/6/4!/4/4/1:30)', paths), { chunk_index: 0, block_id: '0.1' });
  assert.deepEqual(blockForCfi('epubcfi(/6/4!/4/6/4/1:0)', paths), { chunk_index: 0, block_id: '0.2' });
  assert.deepEqual(blockForCfi('epubcfi(/6/4!/4/6/2)', paths), { chunk_index: 0, block_id: '0.1' }); // the figure's image: before its caption
  assert.deepEqual(blockForCfi('epubcfi(/6/6!/4/2/1:0)', paths), { chunk_index: 1, block_id: '1.0' });
  assert.equal(blockForCfi('epubcfi(/6/2!/4/2/1:0)', paths), null); // the cover: no text, no block
});

test('a PDF range gets A4 positions: start from its first quad, end from the last quad of its last page', () => {
  const first = pdfAnchor(12, [[72.5, 140.2, 500, 152], [72, 154, 300.4, 166.9]], 'The tide turns');
  const second = pdfAnchor(13, [[72, 60.3, 200, 72.8]], 'at noon.');
  assert.deepEqual(pdfPositions([first], [612]), { start: 12_014_011, end: 12_016_648 });
  assert.deepEqual(pdfPositions([first, second], [612, 612]), { start: 12_014_011, end: 13_007_232 });
  // the x term stays inside 0-99 even when a quad pokes past the page edge
  assert.deepEqual(pdfPositions([pdfAnchor(2, [[-3, 10, 700, 20]], 'x')], [612]), { start: 2_001_000, end: 2_002_099 });
});

test('an EPUB range gets its spine index and character counts, capped below the next spine item', () => {
  assert.deepEqual(epubPositions(6, 120, 142), { start: 6_000_120, end: 6_000_142 });
  assert.deepEqual(epubPositions(0, 2_000_000, 2_000_010), { start: 999_999, end: 999_999 });
  assert.deepEqual(epubPositions(3, 50, 40), { start: 3_000_050, end: 3_000_050 }); // never ends before it starts
});
