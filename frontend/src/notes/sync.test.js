import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterRange, followAction, notesFor, overlapping, shownRange } from './sync.js';

const M = 1e6;
const note = (id, start, end, created = '2026-11-14T10:00:00Z') => ({ id, position_start: start, position_end: end, created_at: created });

// A PDF: notes on pages 3, 4 (two), 5-6 and 9.
const pdfNotes = [
  note('p9', 9 * M + 100, 9 * M + 900),
  note('p4b', 4 * M + 5000, 4 * M + 5200, '2026-11-14T11:00:00Z'),
  note('p3', 3 * M + 7000, 3 * M + 7100),
  note('p56', 5 * M + 70000, 6 * M + 200), // runs over a page break
  note('p4a', 4 * M + 5000, 4 * M + 5200, '2026-11-14T10:30:00Z'),
];

test('the range shown: whole PDF pages, or an EPUB page\'s characters in its spine item', () => {
  assert.deepEqual(shownRange({ kind: 'pdf', pages: [4, 5] }), { start: 4 * M, end: 5 * M + M - 1 });
  assert.deepEqual(shownRange({ kind: 'pdf', pages: [1] }), { start: 1 * M, end: 1 * M + M - 1 });
  assert.deepEqual(shownRange({ kind: 'epub', index: 2, charStart: 1200, charEnd: 2400 }), { start: 2 * M + 1200, end: 2 * M + 2400 });
  assert.equal(shownRange(null), null);
  assert.equal(shownRange({ kind: 'epub', index: 2 }), null);
});

test('overlapping notes come in book order, oldest first on one spot, including one that runs onto the page', () => {
  const spread = shownRange({ kind: 'pdf', pages: [4, 5] });
  assert.deepEqual(overlapping(pdfNotes, spread).map((n) => n.id), ['p4a', 'p4b', 'p56']);
  assert.deepEqual(overlapping(pdfNotes, shownRange({ kind: 'pdf', pages: [6, 7] })).map((n) => n.id), ['p56']);
  assert.deepEqual(overlapping(pdfNotes, shownRange({ kind: 'pdf', pages: [7, 8] })), []);
  assert.deepEqual(overlapping(pdfNotes, null), []);
});

test('zoom: a spread becoming one page (fit width) keeps the notes of the page still shown, nothing else', () => {
  const before = overlapping(pdfNotes, shownRange({ kind: 'pdf', pages: [4, 5] })).map((n) => n.id);
  const after = overlapping(pdfNotes, shownRange({ kind: 'pdf', pages: [4] })).map((n) => n.id);
  assert.deepEqual(before, ['p4a', 'p4b', 'p56']);
  assert.deepEqual(after, ['p4a', 'p4b']);
});

test('font size and re-pagination: positions are characters, so a note stays with its text when pages change', () => {
  // A note on characters 3000-3100 of spine item 2 and a view note written on a page that showed 2400-3600.
  const notes = [note('sel', 2 * M + 3000, 2 * M + 3100), note('view', 2 * M + 2400, 2 * M + 3600)];
  const at18 = shownRange({ kind: 'epub', index: 2, charStart: 2400, charEnd: 3600 });
  assert.deepEqual(overlapping(notes, at18).map((n) => n.id), ['view', 'sel']);
  // Larger text: the same characters spread over three smaller pages.
  const pages24 = [[2400, 2800], [2800, 3200], [3200, 3600]].map(([a, b]) => shownRange({ kind: 'epub', index: 2, charStart: a, charEnd: b }));
  assert.deepEqual(pages24.map((r) => overlapping(notes, r).map((n) => n.id)), [['view'], ['view', 'sel'], ['view']]);
  // Smaller text: one page now holds 1800-4800, and both notes are on it.
  assert.deepEqual(overlapping(notes, shownRange({ kind: 'epub', index: 2, charStart: 1800, charEnd: 4800 })).map((n) => n.id), ['view', 'sel']);
  // Another spine item: none.
  assert.deepEqual(overlapping(notes, shownRange({ kind: 'epub', index: 3, charStart: 0, charEnd: 3000 })), []);
});

test('the chapter is from the last contents entry at or before the range to the next one', () => {
  const toc = [
    { title: 'Preface', loc: { kind: 'pdf', page: 1 } },
    { title: '4', loc: { kind: 'pdf', page: 4 } },
    { title: '5', loc: { kind: 'pdf', page: 7 } },
  ];
  assert.deepEqual(chapterRange(toc, shownRange({ kind: 'pdf', pages: [5, 6] })), { start: 4 * M, end: 7 * M - 1, title: '4' });
  assert.deepEqual(chapterRange(toc, shownRange({ kind: 'pdf', pages: [8] })), { start: 7 * M, end: Infinity, title: '5' });
  assert.deepEqual(chapterRange([], shownRange({ kind: 'pdf', pages: [8] })), { start: 0, end: Infinity, title: '' });
  const epub = [{ title: 'One', loc: { kind: 'epub', index: 1, char: 0 } }, { title: 'Two', loc: { kind: 'epub', index: 3, char: 0 } }];
  assert.deepEqual(chapterRange(epub, shownRange({ kind: 'epub', index: 2, charStart: 0, charEnd: 900 })), { start: 1 * M, end: 3 * M - 1, title: 'One' });
});

test('the filter: this page, this chapter or all', () => {
  const toc = [{ title: 'A', loc: { kind: 'pdf', page: 1 } }, { title: 'B', loc: { kind: 'pdf', page: 5 } }];
  const range = shownRange({ kind: 'pdf', pages: [4] });
  assert.deepEqual(notesFor(pdfNotes, 'page', range, toc).map((n) => n.id), ['p4a', 'p4b']);
  assert.deepEqual(notesFor(pdfNotes, 'chapter', range, toc).map((n) => n.id), ['p3', 'p4a', 'p4b']);
  assert.deepEqual(notesFor(pdfNotes, 'all', range, toc).map((n) => n.id), ['p3', 'p4a', 'p4b', 'p56', 'p9']);
  assert.deepEqual(notesFor(pdfNotes, 'page', null, toc).map((n) => n.id).length, 5); // no place yet: everything
});

test('when the book moves: scroll, offer the pill while typing, hold after a jump or a hand scroll', () => {
  const now = 10_000;
  assert.equal(followAction({ hasTarget: false, typing: false, now }), 'none');
  assert.equal(followAction({ hasTarget: true, typing: false, now }), 'scroll');
  assert.equal(followAction({ hasTarget: true, typing: true, now }), 'pill');
  assert.equal(followAction({ hasTarget: true, typing: false, now, jumpAt: now - 500 }), 'none');
  assert.equal(followAction({ hasTarget: true, typing: false, now, jumpAt: now - 3000 }), 'scroll');
  assert.equal(followAction({ hasTarget: true, typing: false, now, handAt: now - 1000 }), 'pill');
  assert.equal(followAction({ hasTarget: true, typing: false, now, handAt: now - 2500 }), 'scroll');
});
