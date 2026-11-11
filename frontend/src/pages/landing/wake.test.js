import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetWake, wakeBackend } from './wake.js';

test('sends one GET /health per page load and ignores failures', async () => {
  resetWake();
  const calls = [];
  const failing = (url, init) => { calls.push([url, init.method]); return Promise.reject(new Error('asleep')); };
  assert.equal(wakeBackend('http://api', failing), true);
  assert.equal(wakeBackend('http://api', failing), false);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [['http://api/health', 'GET']]);
});

test('does nothing without fetch', () => {
  resetWake();
  assert.equal(wakeBackend('http://api', null), false);
});
