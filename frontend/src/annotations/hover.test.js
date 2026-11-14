import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotationAt, cycle } from './hover.js';

const box = (left, top, right, bottom) => ({ left, top, right, bottom });

test('the annotation under a point: inside a rect, with a little slack, the latest drawn first', () => {
  const entries = [{ id: 'a', rects: [box(10, 10, 100, 30), box(10, 32, 60, 52)] }, { id: 'b', rects: [box(50, 10, 80, 30)] }];
  assert.equal(annotationAt(entries, 20, 40), 'a');
  assert.equal(annotationAt(entries, 60, 20), 'b'); // over both: the later one, drawn on top
  assert.equal(annotationAt(entries, 101, 20), 'a'); // 1 px past the edge still counts
  assert.equal(annotationAt(entries, 200, 200), null);
  assert.equal(annotationAt([], 0, 0), null);
});

test('A moves through the highlights on the page in reading order, and wraps', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(cycle(ids, null, 1), 'a');
  assert.equal(cycle(ids, 'a', 1), 'b');
  assert.equal(cycle(ids, 'c', 1), 'a');
  assert.equal(cycle(ids, 'a', -1), 'c');
  assert.equal(cycle(ids, 'gone', 1), 'a');
  assert.equal(cycle([], null, 1), null);
});
