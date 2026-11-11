// Blocks for the reader from /sessions/start chunks (C12.3b). Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocksForChunks, placeInChunks } from './blocks.js';

test('stored blocks are used as they are, in chunk order', () => {
  const chunks = [
    { chunk_index: 4, content: 'b', blocks: [{ id: '4.0', type: 'paragraph', text: 'b', marks: [] }] },
    { chunk_index: 3, content: 'a', blocks: [{ id: '3.0', type: 'chapter', text: 'Chapter 2', marks: [] }] },
  ];
  assert.deepEqual(blocksForChunks(chunks).map((b) => b.id), ['3.0', '4.0']);
});

test('a chunk without blocks becomes paragraphs from its text, with the same id scheme', () => {
  const chunks = [{ chunk_index: 7, content: 'First line\nwraps here.\n\n  Second paragraph.  \n\n\n', blocks: null }];
  assert.deepEqual(blocksForChunks(chunks), [
    { id: '7.0', type: 'paragraph', text: 'First line wraps here.', marks: [] },
    { id: '7.1', type: 'paragraph', text: 'Second paragraph.', marks: [] },
  ]);
});

test('missing or empty chunks give no blocks', () => {
  assert.deepEqual(blocksForChunks(undefined), []);
  assert.deepEqual(blocksForChunks([{ chunk_index: 0, content: '   ', blocks: [] }]), []);
});

test('a saved place is resumed only when it lies in today\'s chunks', () => {
  const chunks = [{ chunk_index: 5 }, { chunk_index: 6 }];
  const place = { chunk_index: 6, block_id: '6.2', char_offset: 30 };
  assert.deepEqual(placeInChunks(place, chunks), { block_id: '6.2', char_offset: 30 });
  assert.equal(placeInChunks({ ...place, chunk_index: 4, block_id: '4.0' }, chunks), null);
  assert.equal(placeInChunks(null, chunks), null);
});
