// node --test (npm run test:unit): the backend readiness state machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIVE_UP_AFTER_MS, SHOW_AFTER_MS, errorLine, start, step } from './backendReady.js';

const run = (state, events) => events.reduce(step, state);
const ready = { type: 'health', ok: true, status: 200, modelReady: true };
const loading = { type: 'health', ok: true, status: 200, modelReady: false };

test('a warm start is ready before the warm-up screen would show', () => {
  const state = run(start(0), [ready, { type: 'tick', now: SHOW_AFTER_MS }]);
  assert.equal(state.phase, 'ready');
});

test('not ready within 1.5 s shows the warm-up, then ready when the model is', () => {
  let state = run(start(0), [{ type: 'fail' }, { type: 'tick', now: SHOW_AFTER_MS - 1 }]);
  assert.equal(state.phase, 'checking');
  state = step(state, { type: 'tick', now: SHOW_AFTER_MS });
  assert.equal(state.phase, 'warming');
  state = run(state, [loading, { type: 'tick', now: 30_000 }]);
  assert.equal(state.phase, 'warming');
  assert.equal(step(state, ready).phase, 'ready');
});

test('no answer in 90 s is down, with the last status on the error line', () => {
  let state = run(start(0), [{ type: 'tick', now: SHOW_AFTER_MS }, { type: 'health', ok: false, status: 503, modelReady: false }]);
  state = step(state, { type: 'tick', now: GIVE_UP_AFTER_MS });
  assert.equal(state.phase, 'down');
  assert.equal(errorLine(state), 'Error 503 · GET /health');
  assert.equal(errorLine(step(start(0), { type: 'fail' })), 'No response · GET /health');
  assert.equal(step(state, ready).phase, 'down'); // final until Try again starts a new check
});

test('answering but still loading the model after 90 s lets the reader in', () => {
  const state = run(start(0), [loading, { type: 'tick', now: GIVE_UP_AFTER_MS }]);
  assert.equal(state.phase, 'ready');
});

test('Try again starts warm, without the quiet 1.5 s', () => {
  const state = start(100_000, { warm: true });
  assert.equal(state.phase, 'warming');
  assert.equal(step(state, { type: 'tick', now: 100_000 + GIVE_UP_AFTER_MS - 1 }).phase, 'warming');
});
