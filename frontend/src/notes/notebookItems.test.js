import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerItems, codeItems, latexItems, passageItems } from './notebookItems.js';

test('a passage is its reference, small and muted, then its words wrapped', () => {
  const items = passageItems('The cost of a thing is the amount of what I will call life which is required to be exchanged for it', 'p. 31 · Economy');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { text: 'p. 31 · Economy', size: 14, font: 'hand', muted: true });
  assert.equal(items[1].size, 16);
  assert.ok(items[1].text.split('\n').every((l) => l.length <= 56));
  assert.equal(items[1].text.replace(/\n/g, ' '), 'The cost of a thing is the amount of what I will call life which is required to be exchanged for it');
  assert.deepEqual(passageItems('', 'p. 2'), [{ text: 'p. 2', size: 14, font: 'hand', muted: true }]); // whole pages: only where
  assert.deepEqual(passageItems('Words'), [{ text: 'Words', size: 16, font: 'hand', muted: false }]);
});

test('a Steve answer keeps its heading, paragraphs, lists, math, code and sources as text', () => {
  const answer = 'A Fourier series sums **sines** $a_n$ [p. 2].\n\n1. first\n2. second\n\n$$\\sum a_n$$\n\n```python\nx = 1\n```';
  const items = answerItems(answer, [{ label: 'p. 2' }, { label: 'p. 2' }, { label: 'p. 5' }], 'Steve · from page 2');
  assert.deepEqual(items.map((i) => i.text), [
    'Steve · from page 2',
    'A Fourier series sums sines $a_n$ [p. 2].',
    '1. first\n2. second',
    '$$\\sum a_n$$',
    'x = 1',
    'Sources: p. 2, p. 5',
  ]);
  assert.deepEqual(items.map((i) => i.font), ['hand', 'hand', 'hand', 'code', 'code', 'hand']);
  assert.deepEqual(items.map((i) => i.muted), [true, false, false, false, false, true]);
});

test('code keeps its lines and LaTeX is fenced, both in the code face', () => {
  assert.deepEqual(codeItems('def f():\n    return 1', 'p. 1'), [
    { text: 'p. 1', size: 14, font: 'hand', muted: true },
    { text: 'def f():\n    return 1', size: 14, font: 'code', muted: false },
  ]);
  assert.deepEqual(latexItems(' a^2 + b^2 '), [{ text: '$$a^2 + b^2$$', size: 14, font: 'code', muted: false }]);
});
