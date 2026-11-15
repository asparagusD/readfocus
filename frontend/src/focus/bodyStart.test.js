import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beforeBody, chosenStart, isStartEntry, startLabel } from './bodyStart.js';

const pdfStart = { kind: 'pdf', page: 9, title: 'Chapter 1' };
const epubStart = { kind: 'epub', spine_index: 3, title: null };
const pdfPlace = (...pages) => ({ kind: 'pdf', pages });
const epubPlace = (index, charStart = 0, charEnd = 500) => ({ kind: 'epub', index, charStart, charEnd });

test('PDF pages wholly before the body start are front matter; a spread reaching it is not', () => {
  assert.equal(beforeBody(pdfPlace(7, 8), pdfStart), true);
  assert.equal(beforeBody(pdfPlace(8, 9), pdfStart), false);
  assert.equal(beforeBody(pdfPlace(12), pdfStart), false);
});

test('EPUB sections before the start section are front matter, at any text size', () => {
  assert.equal(beforeBody(epubPlace(2, 4000, 4900), epubStart), true);
  assert.equal(beforeBody(epubPlace(3), epubStart), false);
  assert.equal(beforeBody(epubPlace(5), epubStart), false);
});

test('nothing is front matter without a known start or before the book opens', () => {
  assert.equal(beforeBody(pdfPlace(1), null), false);
  assert.equal(beforeBody(null, pdfStart), false);
  assert.equal(beforeBody(epubPlace(0), pdfStart), false); // another kind: a stale answer, never a lock
});

test('the label is the start entry title when short, else Chapter 1', () => {
  assert.equal(startLabel(pdfStart), 'Chapter 1');
  assert.equal(startLabel({ ...pdfStart, title: 'Part One: Foundations' }), 'Part One: Foundations');
  assert.equal(startLabel(epubStart), 'Chapter 1');
  assert.equal(startLabel({ ...pdfStart, title: 'x'.repeat(60) }), 'Chapter 1');
});

test('the contents entry at the start is marked', () => {
  assert.equal(isStartEntry({ loc: { kind: 'pdf', page: 9 } }, pdfStart), true);
  assert.equal(isStartEntry({ loc: { kind: 'pdf', page: 10 } }, pdfStart), false);
  assert.equal(isStartEntry({ loc: { kind: 'epub', index: 3, char: 0 } }, epubStart), true);
  assert.equal(isStartEntry({ loc: { kind: 'epub', index: 3, char: 0 } }, null), false);
});

test('"The book starts here" sends the first page or section shown and its chapter', () => {
  assert.deepEqual(chosenStart(pdfPlace(12, 13), 'Prologue'), { page: 12, title: 'Prologue' });
  assert.deepEqual(chosenStart(epubPlace(4), ''), { spine_index: 4, title: null });
  assert.equal(chosenStart(pdfPlace(2), 'y'.repeat(300)).title.length, 200);
  assert.equal(chosenStart(null, 'x'), null);
});
