import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_MATH, INLINE_MATH } from './mathRules.js';

test('$…$ becomes inline math when its closing $ is typed', () => {
  assert.equal('so $a^2 + b^2$'.match(INLINE_MATH)?.[1], 'a^2 + b^2');
  assert.equal('$x$'.match(INLINE_MATH)?.[1], 'x');
  assert.equal('costs $5 or $'.match(INLINE_MATH), null); // a space before the closing $: prices, not math
  assert.equal('a $ b$'.match(INLINE_MATH), null); // starts with a space
  assert.equal('\\$x$'.match(INLINE_MATH), null); // an escaped dollar
  assert.equal('$$x$'.match(INLINE_MATH), null); // the start of display math
  assert.equal('$$x$$'.match(INLINE_MATH), null);
});

test('$$…$$ alone in a paragraph becomes display math', () => {
  assert.equal('$$\\sum_{k=1}^n k$$'.match(BLOCK_MATH)?.[1], '\\sum_{k=1}^n k');
  assert.equal('see $$x$$'.match(BLOCK_MATH), null);
  assert.equal('$$$$'.match(BLOCK_MATH), null);
});
