import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollWithBackoff } from './backoff.js';

/** Timers run by hand: each setTimer records its delay; run() fires the latest. */
function clock() {
  const delays = [];
  let pending = null;
  return {
    delays,
    setTimer: (fn, ms) => { delays.push(ms); pending = fn; return delays.length; },
    clearTimer: () => { pending = null; },
    run: async () => { const fn = pending; pending = null; await fn?.(); },
  };
}

test('the waits double from 5 s and stay at 60 s', async () => {
  const c = clock();
  let checks = 0;
  pollWithBackoff(async () => { checks += 1; }, c);
  for (let i = 0; i < 6; i += 1) await c.run();
  assert.equal(checks, 6);
  assert.deepEqual(c.delays, [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
});

test('a failed check is waited out like any other', async () => {
  const c = clock();
  pollWithBackoff(async () => { throw new Error('down'); }, c);
  await c.run();
  await c.run();
  assert.deepEqual(c.delays, [5000, 10000, 20000]);
});

test('stop ends it, also during a check', async () => {
  const c = clock();
  let stop;
  stop = pollWithBackoff(async () => { stop(); }, c);
  await c.run();
  assert.deepEqual(c.delays, [5000]); // nothing scheduled after the stop
});
