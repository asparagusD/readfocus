// node --test (npm run test:unit): the dashboard's pure helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greeting, lastScore, lastScores, partOfDay, streakLine, testsThisWeek } from './dashboard.js';

const at = (iso) => new Date(iso); // local time

test('part of the day by the reader\'s clock', () => {
  assert.equal(partOfDay(at('2026-11-11T07:00:00')), 'morning');
  assert.equal(partOfDay(at('2026-11-11T13:30:00')), 'afternoon');
  assert.equal(partOfDay(at('2026-11-11T20:15:00')), 'evening');
  assert.equal(partOfDay(at('2026-11-11T02:00:00')), 'evening');
  assert.deepEqual(greeting(at('2026-11-11T20:15:00')), { eyebrow: 'Wednesday evening', title: 'Good evening.' });
});

test('the streak in words', () => {
  assert.equal(streakLine(12), '12 days in a row');
  assert.equal(streakLine(1), '1 day in a row');
  assert.match(streakLine(0), /^No streak yet/);
});

test('the last eight tests, oldest first, and the latest score', () => {
  const scores = Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(10 - i).padStart(2, '0')}`, score_pct: 50 + i + 0.4 }));
  const last = lastScores(scores);
  assert.equal(last.length, 8);
  assert.deepEqual(last.map((s) => s.date), ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
  assert.deepEqual(last.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(lastScore(scores), 50);
  assert.equal(lastScore([]), null);
});

test('tests this week count from Monday', () => {
  const scores = [{ date: '2026-11-08' }, { date: '2026-11-09' }, { date: '2026-11-11' }]; // Sun, Mon, Wed
  assert.equal(testsThisWeek(scores, at('2026-11-11T20:00:00')), 2);
  assert.equal(testsThisWeek(scores, at('2026-11-09T08:00:00')), 2);
  assert.equal(testsThisWeek([], at('2026-11-11T20:00:00')), 0);
});
