import test from 'node:test';
import assert from 'node:assert/strict';
import { earnedOn, newlyEarned, seenAfter, shelfLine } from './shelfMath.js';

test('the shelf line counts earned badges, or nudges kindly before the first', () => {
  assert.equal(shelfLine(4, 14), '4 of 14 earned');
  assert.equal(shelfLine(0, 14), 'Your first badge comes with your first focus session');
  assert.doesNotMatch(shelfLine(0, 14), /lose|miss|yet to|only/i);
});

test('earned dates read as a day, a short month and a year', () => {
  assert.equal(earnedOn('2026-11-17T10:00:00+00:00'), 'Earned 17 Nov 2026');
  assert.equal(earnedOn('not a date'), 'Earned');
});

const badges = [{ id: 'a', earned: true }, { id: 'b', earned: true }, { id: 'c', earned: false }];

test('a badge stamps in once: earned and not yet seen on this device', () => {
  assert.deepEqual(newlyEarned(badges, []), ['a', 'b']);
  assert.deepEqual(newlyEarned(badges, ['a']), ['b']);
  assert.deepEqual(newlyEarned(badges, ['a', 'b']), []);
});

test('after a visit every earned badge is remembered, sorted, without repeats', () => {
  assert.deepEqual(seenAfter(badges, ['b', 'z']), ['a', 'b', 'z']);
  assert.deepEqual(seenAfter([], []), []);
});
