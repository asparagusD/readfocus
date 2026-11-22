import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitUnder, keptFiles, libraryStore } from './pageImages.js';

test('a picture is made smaller until it fits under the limit, else nothing', async () => {
  const tried = [];
  const encode = async (side, quality) => { tried.push([side, quality]); return { size: side * 200 * quality }; };
  const blob = await fitUnder(encode, 100_000);
  assert.ok(blob.size <= 100_000);
  assert.deepEqual(tried.at(-1), [700, 0.6]);
  assert.deepEqual(tried[0], [1600, 0.82]); // the largest, best first
  assert.equal(await fitUnder(async () => ({ size: 10_000_000 }), 100_000), null);
  assert.equal(await fitUnder(async () => null, 100_000), null);
});

test('a page keeps the files of its live pictures that are uploaded', () => {
  const stored = new Map([['f1', { path: 'u/b/1.webp', mimeType: 'image/webp', extra: 1 }], ['f3', { path: 'u/b/3.png', mimeType: 'image/png' }]]);
  const elements = [
    { type: 'image', fileId: 'f1' },
    { type: 'image', fileId: 'f2' }, // still uploading
    { type: 'image', fileId: 'f3', isDeleted: true },
    { type: 'rectangle' },
  ];
  assert.deepEqual(keptFiles(elements, stored), { f1: { path: 'u/b/1.webp', mimeType: 'image/webp' } });
  assert.deepEqual(keptFiles(undefined, stored), {});
});

test('the library is kept in this browser, and an unreadable store is an empty library', () => {
  const kept = new Map();
  const store = libraryStore({ getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) });
  assert.deepEqual(store.load(), []);
  store.save([{ id: 'a' }]);
  assert.deepEqual(store.load(), [{ id: 'a' }]);
  const broken = libraryStore({ getItem: () => '{not json', setItem: () => { throw new Error('full'); } });
  assert.deepEqual(broken.load(), []);
  broken.save([{ id: 'b' }]); // does not throw
});
