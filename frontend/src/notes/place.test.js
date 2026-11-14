import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterOf, inBookOrder, reference } from './place.js';
import { overallStatus } from './status.js';

test('the notepad says the worst save state among its notes', () => {
  assert.equal(overallStatus({}, []), '');
  assert.equal(overallStatus({}, ['a']), 'All notes saved');
  assert.equal(overallStatus({ a: { status: 'saving' } }, ['a', 'b']), 'Saving…');
  assert.match(overallStatus({ a: { status: 'offline' }, b: { status: 'unsaved' } }, ['a', 'b']), /^Offline/);
  assert.equal(overallStatus({ a: { status: 'offline' }, b: { status: 'conflict' } }, ['a', 'b']), 'Some notes are not saved');
});

const pdfToc = [
  { title: 'Preface', loc: { kind: 'pdf', page: 1 } },
  { title: '4 Fourier series', loc: { kind: 'pdf', page: 40 } },
  { title: '5 Transforms', loc: { kind: 'pdf', page: 60 } },
];
const epubToc = [
  { title: 'One', loc: { kind: 'epub', index: 1, char: 0 } },
  { title: 'Two', loc: { kind: 'epub', index: 3, char: 0 } },
];

test('a note belongs to the last contents entry at or before its start', () => {
  assert.equal(chapterOf({ position_start: 45_006_007 }, pdfToc), '4 Fourier series');
  assert.equal(chapterOf({ position_start: 40_000_000 }, pdfToc), '4 Fourier series');
  assert.equal(chapterOf({ position_start: 61_000_000 }, pdfToc), '5 Transforms');
  assert.equal(chapterOf({ position_start: 2_000_120 }, epubToc), 'One');
  assert.equal(chapterOf({ position_start: 0 }, epubToc), '');
  assert.equal(chapterOf({ position_start: 5 }, []), '');
});

test('the reference is the page, then the chapter when there is one', () => {
  assert.equal(reference('p. 45', '4 Fourier series'), 'p. 45 · 4 Fourier series');
  assert.equal(reference('pp. 44–45', ''), 'pp. 44–45');
  assert.equal(reference('', 'One'), 'One');
  assert.equal(reference('', ''), 'This book');
});

test('notes are in book order, then oldest first on the same spot', () => {
  const notes = [
    { id: 'c', position_start: 45_000_000, created_at: '2026-11-14T10:00:00Z' },
    { id: 'b', position_start: 44_014_014, created_at: '2026-11-14T12:00:00Z' },
    { id: 'a', position_start: 44_014_014, created_at: '2026-11-14T11:00:00Z' },
  ];
  assert.deepEqual(inBookOrder(notes).map((n) => n.id), ['a', 'b', 'c']);
});
