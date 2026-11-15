import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epubEndPoint, pageForX, pdfPageEnd } from './bookmark.js';

test('a PDF bookmark is a point at the bottom of its page', () => {
  assert.deepEqual(pdfPageEnd(45, 792), { kind: 'pdf', page: 45, quads: [[0, 792, 0, 792]], text: '' });
  assert.deepEqual(pdfPageEnd(3, 10_400).quads, [[0, 9_999, 0, 9_999]]); // A4 positions hold y under 10,000
});

test('an EPUB bookmark is the end of the range shown, as a point CFI', () => {
  assert.deepEqual(epubEndPoint('epubcfi(/6/14!/4/2,/1:0,/12/1:210)'),
    { kind: 'epub', cfi: 'epubcfi(/6/14!/4/2/12/1:210)', text: '' });
  assert.equal(epubEndPoint('epubcfi(/6/14!/4/2/1:0)'), null);
  assert.equal(epubEndPoint(null), null);
});

test('the ribbon dropped over a spread picks the page under it', () => {
  const box = { left: 100, width: 800 };
  assert.equal(pageForX(150, box, 2), 0);
  assert.equal(pageForX(510, box, 2), 1);
  assert.equal(pageForX(5000, box, 2), 1);
  assert.equal(pageForX(-50, box, 2), 0);
  assert.equal(pageForX(510, box, 1), 0);
});
