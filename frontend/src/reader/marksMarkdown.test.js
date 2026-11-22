import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterFor, marksMarkdown } from './marksMarkdown.js';

const date = new Date('2026-11-22T12:00:00Z');
const mark = (id, start, text, extra = {}) => ({ id, style: 'highlight', color: 'honey', position_start: start,
  anchors: [{ kind: 'epub', cfi: `epubcfi(/6/${id})`, text }], comment: null, ...extra });

test("an EPUB's marks as Markdown: chapter by chapter in reading order, with their colour, page and comment", () => {
  const annotations = [
    mark('b', 2e6 + 40, 'Second chapter words.', { style: 'underline', color: 'sky' }),
    mark('a', 1e6 + 10, 'The lamp threw a small circle. Inside it, the page.', { comment: 'Lovely\nline two' }),
    mark('c', 2e6 + 90, 'Later in two.'),
  ];
  const chapters = { 1: 'Chapter 1', 2: 'Chapter 2' };
  const md = marksMarkdown({ title: 'Walden', annotations, date,
    chapterOf: (a) => chapters[Math.floor(a.position_start / 1e6)], pageOf: (a) => `p. ${a.id === 'a' ? 3 : 9}` });
  assert.equal(md, [
    '# Walden: my highlights', '', 'From ReadFocus, 22 November 2026.',
    '', '## Chapter 1', '', '> The lamp threw a small circle.\n> Inside it, the page.', '', 'Highlight (Honey) · p. 3',
    '', '**Comment:** Lovely', 'line two',
    '', '## Chapter 2', '', '> Second chapter words.', '', 'Underline (Sky) · p. 9',
    '', '> Later in two.', '', 'Highlight (Honey) · p. 9', '',
  ].join('\n'));
});

test('no marks says so; a mark with no words is left out; no chapter is named as before the first', () => {
  assert.match(marksMarkdown({ title: 'Walden', annotations: [], date }), /No highlights yet\.\n$/);
  const md = marksMarkdown({ title: '', annotations: [mark('x', 5, '   '), mark('y', 9, 'Kept.')], date });
  assert.ok(md.startsWith('# Book: my highlights'));
  assert.ok(md.includes('## Before the first chapter\n\n> Kept.'));
  assert.ok(!md.includes('epubcfi'));
});

test("an annotation's chapter is the last contents entry at or before its section", () => {
  const toc = [{ title: 'Cover', loc: { index: 0 } }, { title: 'Chapter 1', loc: { index: 1 } },
    { title: 'A part of it', loc: { index: 1 } }, { title: 'Chapter 2', loc: { index: 3 } }];
  assert.equal(chapterFor(toc, { position_start: 2e6 + 5 }), 'A part of it');
  assert.equal(chapterFor(toc, { position_start: 3e6 }), 'Chapter 2');
  assert.equal(chapterFor(toc, { position_start: 0 }), 'Cover');
  assert.equal(chapterFor([], { position_start: 3e6 }), null);
});
