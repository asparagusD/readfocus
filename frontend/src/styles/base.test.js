// Regression (DEBUG_LOG 2026-11-11 C12.3): under reduced motion, transitions must be instant (0s), not
// tiny. Every element's transition-property defaults to `all`, so a non-zero duration on every element
// turns each style change into a transition, and code that measures layout right after a change
// (the paginated reader) reads the old values. Run: npm run test:unit
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('./base.css', import.meta.url), 'utf8');
const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? '';

test('base.css has a reduced-motion block', () => {
  assert.match(block, /animation-iteration-count: 1 !important/);
});

test('reduced motion makes transitions instant rather than 0.01 ms long', () => {
  const durations = [...block.matchAll(/transition-duration:\s*([^;!]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(durations, ['0s']);
  assert.match(block, /transition-delay:\s*0s !important/);
});
