import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEASE_MS, claim, heldElsewhere, release } from './writer.js';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
};

test('the first tab takes the lease and a second tab is read-only while it is live', () => {
  const s = memory();
  assert.equal(claim(s, 'f1', 'A', 0), true);
  assert.equal(claim(s, 'f1', 'B', 30_000), false);
  assert.equal(heldElsewhere(s, 'f1', 'B', 30_000), true);
  assert.equal(claim(s, 'f1', 'A', 30_000), true); // the writer renews
  assert.equal(claim(s, 'f1', 'B', 30_000 + LEASE_MS - 1), false);
});

test('a lapsed lease passes to the next tab that asks', () => {
  const s = memory();
  claim(s, 'f1', 'A', 0);
  assert.equal(claim(s, 'f1', 'B', LEASE_MS), true);
  assert.equal(claim(s, 'f1', 'A', LEASE_MS + 1), false);
});

test('release frees the lease only for its holder; sessions do not share one', () => {
  const s = memory();
  claim(s, 'f1', 'A', 0);
  release(s, 'f1', 'B');
  assert.equal(claim(s, 'f1', 'B', 1), false);
  release(s, 'f1', 'A');
  assert.equal(claim(s, 'f1', 'B', 2), true);
  assert.equal(claim(s, 'f2', 'A', 3), true);
});

test('no storage, or storage that throws, never blocks the tab', () => {
  assert.equal(claim(null, 'f1', 'A', 0), true);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
  assert.equal(claim(broken, 'f1', 'A', 0), true);
  assert.equal(heldElsewhere(broken, 'f1', 'A', 0), false);
});
