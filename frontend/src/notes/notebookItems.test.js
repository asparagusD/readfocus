import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerItems, codeItems, imageItems, latexItems, passageItems, typedLines } from './notebookItems.js';

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

test('a typed note becomes its reference and its blocks as text; an empty one nothing', () => {
  const doc = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'The ' }, { type: 'text', text: 'coefficients', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' say how much: ' }, { type: 'inlineMath', attrs: { latex: 'a_n' } }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the lamp' }] }] },
    { type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'read 4.2' }] }] },
      { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'work 4.4' }] }] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'third' }] }] }] },
    { type: 'blockMath', attrs: { latex: '\\sum k' } },
    { type: 'paragraph' },
    { type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] },
  ] };
  const items = typedLines(doc, 'p. 1 · Economy');
  assert.deepEqual(items.map((i) => i.text), [
    'p. 1 · Economy',
    'The coefficients say how much: $a_n$',
    '“the lamp”',
    '☑ read 4.2\n☐ work 4.4',
    '3. third',
    '$$\\sum k$$',
    'one\ntwo',
  ]);
  assert.deepEqual(items.map((i) => i.font), ['hand', 'hand', 'hand', 'hand', 'hand', 'code', 'hand']);
  assert.deepEqual(typedLines({ type: 'doc', content: [{ type: 'paragraph' }] }, 'p. 1'), []);
  assert.deepEqual(typedLines(null), []);
});

test('a picture from the book is its reference, the picture, then its caption', () => {
  const picture = { dataURL: 'data:image/png;base64,AAAA', path: 'u/b/1.png', mimeType: 'image/png' };
  assert.deepEqual(imageItems(picture, 'Figure 1. The toll road.', 'p. 1'), [
    { text: 'p. 1', size: 14, font: 'hand', muted: true },
    { image: picture },
    { text: 'Figure 1. The toll road.', size: 14, font: 'hand', muted: true },
  ]);
  assert.deepEqual(imageItems(picture), [{ image: picture }]);
});
