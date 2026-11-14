import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, memoryStore, idbStore } from './queue.js';

test('the queue keeps one entry per note, the latest', async () => {
  const queue = createQueue(memoryStore());
  await queue.put({ id: 'a', change: { content: 1 }, version: 1 });
  await queue.put({ id: 'b', change: { content: 2 }, version: 3 });
  await queue.put({ id: 'a', change: { content: 9 }, version: 1 });
  assert.deepEqual(await queue.all(), [{ id: 'a', change: { content: 9 }, version: 1 }, { id: 'b', change: { content: 2 }, version: 3 }]);
  await queue.drop('a');
  assert.deepEqual((await queue.all()).map((e) => e.id), ['b']);
});

test('without IndexedDB (or when it throws) the queue still works for the visit', async () => {
  const queue = createQueue(idbStore(undefined));
  await queue.put({ id: 'a', change: {}, version: 1 });
  assert.equal((await queue.all()).length, 1);
  const broken = { open: () => { throw new Error('SecurityError'); } };
  const fallback = createQueue(idbStore(broken));
  await fallback.put({ id: 'b', change: {}, version: 2 });
  assert.deepEqual((await fallback.all()).map((e) => e.id), ['b']);
});
