import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPage, storedOutline } from './contents.js';

test('the stored outline stands in for the PDF outline: titles and pages, in order', () => {
  const toc = [
    { title: 'Cover', page: 1, chunk_index: 0, block_id: '0.0' },
    { title: 'Chapter 1', page: 23, chunk_index: 4, block_id: '4.2' },
  ];
  assert.deepEqual(storedOutline(toc), [{ title: 'Cover', page: 1 }, { title: 'Chapter 1', page: 23 }]);
});

test('no stored contents, or headings with no pages, mean the outline is read from the PDF', () => {
  assert.equal(storedOutline(null), null);
  assert.equal(storedOutline([]), null);
  assert.equal(storedOutline([{ title: 'A heading', chunk_index: 2, block_id: '2.0' }]), null);
  assert.equal(storedOutline([{ title: 'Cover', page: 1 }, { title: 'Found in the text', chunk_index: 3 }]), null);
  assert.equal(storedOutline([{ title: 'Bad page', page: 0 }]), null);
});

test('a saved PDF place opens at its page; anything else at page 1', () => {
  assert.equal(startPage({ kind: 'pdf', page: 400, quads: [] }), 400);
  assert.equal(startPage({ kind: 'epub', cfi: 'epubcfi(/6/4!/4/2/1:0)' }), 1);
  assert.equal(startPage(null), 1);
  assert.equal(startPage({ kind: 'pdf', page: 0 }), 1);
});
