import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listed, pdfPagesLabel, snippetOf } from './list.js';

const note = (id, start, color, extra = {}) => ({ id, position_start: start, color, style: 'highlight', anchors: [], ...extra });

test('the list is in reading order, all colours or one', () => {
  const all = [note('c', 3_000_100, 'sky'), note('a', 1_000_500, 'honey'), note('b', 1_020_000, 'sky')];
  assert.deepEqual(listed(all, null).map((a) => a.id), ['a', 'b', 'c']);
  assert.deepEqual(listed(all, 'sky').map((a) => a.id), ['b', 'c']);
  assert.deepEqual(listed(all, 'rose'), []);
  assert.deepEqual(all.map((a) => a.id), ['c', 'a', 'b']); // the reader's list is left as it was
});

test('a PDF annotation is labelled with its printed page, or the pages it crosses', () => {
  const one = { anchors: [{ kind: 'pdf', page: 3 }] };
  const two = { anchors: [{ kind: 'pdf', page: 3 }, { kind: 'pdf', page: 4 }] };
  assert.equal(pdfPagesLabel(one, null), 'p. 3');
  assert.equal(pdfPagesLabel(one, ['i', 'ii', '1', '2']), 'p. 1');
  assert.equal(pdfPagesLabel(two, ['i', 'ii', '1', '2']), 'pp. 1–2');
  assert.equal(pdfPagesLabel({ anchors: [{ kind: 'epub', cfi: 'x' }] }, null), '');
});

test('the snippet is the saved text, whitespace collapsed, cut at a word with an ellipsis', () => {
  assert.equal(snippetOf({ text_snapshot: '  The lamp   threw  ' }), 'The lamp threw');
  assert.equal(snippetOf({ anchors: [{ text: 'end of' }, { text: 'four' }] }), 'end of four'); // a pending one
  assert.equal(snippetOf({ text_snapshot: 'one two three four five' }, 12), 'one two…');
});
