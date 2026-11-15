import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closePdf } from './close.js';

test('a PDF.js 6 document is closed through its loading task (it has no destroy of its own)', async () => {
  const calls = [];
  const doc = { loadingTask: { destroy: async () => { calls.push('task'); } } };
  await closePdf(doc);
  assert.deepEqual(calls, ['task']);
});

test('an older document with destroy() is closed by it; nothing open is fine', async () => {
  const calls = [];
  await closePdf({ destroy: async () => { calls.push('doc'); }, loadingTask: { destroy: () => calls.push('task') } });
  assert.deepEqual(calls, ['doc']);
  assert.equal(await closePdf(null), undefined);
  assert.equal(await closePdf({}), undefined);
});
