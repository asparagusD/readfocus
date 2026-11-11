// Reader text size steps (C12.5a). Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIZES, DEFAULT_SIZE, parseSize, stepSize } from './textSize.js';

test('three sizes from the handoff, 18 px by default', () => {
  assert.deepEqual(SIZES, [16.5, 18, 19.5]);
  assert.equal(DEFAULT_SIZE, 18);
});

test('stepping stops at either end', () => {
  assert.equal(stepSize(18, 1), 19.5);
  assert.equal(stepSize(19.5, 1), 19.5);
  assert.equal(stepSize(18, -1), 16.5);
  assert.equal(stepSize(16.5, -1), 16.5);
});

test('a stored value is used only when it is one of the sizes', () => {
  assert.equal(parseSize('19.5'), 19.5);
  assert.equal(parseSize('22'), 18);
  assert.equal(parseSize(null), 18);
  assert.equal(parseSize('abc'), 18);
});
