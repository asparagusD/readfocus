import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPattern, findStatus, locate, matchesIn, searchOrder, spotOf, stepMatch } from './find.js';

test('a query ignores case, and a space matches any white space or none', () => {
  const pattern = findPattern('  Circle   of light ');
  assert.deepEqual(matchesIn('a small circle of light. A CIRCLE OFlight', pattern), [[8, 23], [27, 41]]);
  assert.deepEqual(matchesIn('the circle\nof light', pattern), [[4, 19]]);
  assert.equal(findPattern(''), null);
  assert.equal(findPattern('   '), null);
  assert.deepEqual(matchesIn('anything', null), []);
});

test('a query is taken literally, not as a pattern', () => {
  assert.deepEqual(matchesIn('costs $5.00 (or 5x00)', findPattern('$5.00')), [[6, 11]]);
  assert.deepEqual(matchesIn('f(x) = [a+b]*c', findPattern('[a+b]*c')), [[7, 14]]);
  assert.deepEqual(matchesIn('5x00', findPattern('5.00')), []);
});

test('the pages are searched from the one in view to the end, then from the first', () => {
  assert.deepEqual(searchOrder(6, 3), [3, 4, 5, 6, 1, 2]);
  assert.deepEqual(searchOrder(6, 1), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(searchOrder(3, 9), [3, 1, 2]);
  assert.deepEqual(searchOrder(0, 1), []);
});

test('next and previous go round the book; none when nothing matched', () => {
  assert.equal(stepMatch(0, 3, 1), 1);
  assert.equal(stepMatch(2, 3, 1), 0);
  assert.equal(stepMatch(0, 3, -1), 2);
  assert.equal(stepMatch(-1, 3, 1), 0);
  assert.equal(stepMatch(-1, 3, -1), 2);
  assert.equal(stepMatch(0, 0, 1), -1);
});

test('a match is placed at its item\'s top, as far across as it is into the item', () => {
  // two items: "Chapter 1 " at (72, 90) 100 wide, "Signals" at (172, 90) 70 wide; the page's text is 17 long
  const spots = Float32Array.from([0, 72, 90, 100, 10, 172, 90, 70]);
  assert.deepEqual(spotOf(spots, 17, 0), { x: 72, y: 90 });
  assert.deepEqual(spotOf(spots, 17, 5), { x: 122, y: 90 });
  assert.deepEqual(spotOf(spots, 17, 10), { x: 172, y: 90 });
  assert.deepEqual(spotOf(new Float32Array(0), 0, 3), { x: 0, y: 0 });
});

test('a match across text nodes is found in each', () => {
  assert.deepEqual(locate([10, 7], 10, 17), { from: [1, 0], to: [1, 7] });
  assert.deepEqual(locate([10, 7], 8, 12), { from: [0, 8], to: [1, 2] });
  assert.deepEqual(locate([10, 0, 7], 2, 10), { from: [0, 2], to: [0, 10] });
  assert.equal(locate([10, 7], 15, 20), null);
});

test('the bar says where the reader is among the matches, or that the search goes on', () => {
  assert.equal(findStatus({ query: '' }), '');
  assert.equal(findStatus({ query: 'lamp', done: false }), 'Searching…');
  assert.equal(findStatus({ query: 'lamp', count: 12, done: false }), '12 found so far…');
  assert.equal(findStatus({ query: 'lamp', count: 0, done: true }), 'No matches');
  assert.equal(findStatus({ query: 'lamp', count: 84, index: 2, done: true }), '3 of 84');
});
