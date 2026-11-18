// node --test (npm run test:unit): the dashboard's pure helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookLine, focusWeek, focusedTime, greeting, lastScore, lastScores, needsRevisiting, nextBook, partOfDay, streakLine, testsThisWeek } from './dashboard.js';

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

test('needs revisiting matches the planner: tested and under 0.5', () => {
  assert.equal(needsRevisiting({ mastery: 0.41, attempts: 2 }), true);
  assert.equal(needsRevisiting({ mastery: 0.5, attempts: 2 }), false);
  assert.equal(needsRevisiting({ mastery: 0.3, attempts: 0 }), false); // untested: only the prior
});

test('C23.7c: focused time in hours and minutes', () => {
  assert.equal(focusedTime(0), '0 min');
  assert.equal(focusedTime(1500), '25 min');
  assert.equal(focusedTime(4200), '1 h 10 min');
});

test('C23.7c: the focus card says how many sessions, or how to start one', () => {
  assert.deepEqual(focusWeek({ seconds: 4200, points: 1540, sessions: 2 }),
    { time: '1 h 10 min', points: '1,540', line: 'From 2 focus sessions since Monday.' });
  assert.equal(focusWeek({ seconds: 600, points: 0, sessions: 1 }).line, 'From 1 focus session since Monday.');
  assert.equal(focusWeek(undefined).line, 'Turn on Focus mode in a book and your focused time and points gather here.');
});

test('a book line says how far it is read and the quizzes taken, never sessions (C32.3)', () => {
  assert.equal(bookLine({ progress_pct: 41.6, sessions_completed: 3 }), '42% read · 3 quizzes');
  assert.equal(bookLine({ progress_pct: 10, sessions_completed: 1 }), '10% read · 1 quiz');
  assert.equal(bookLine({ progress_pct: 0, sessions_completed: 0 }), '0% read');
  assert.equal(bookLine({ progress_pct: 130, sessions_completed: 2 }), '100% read · 2 quizzes'); // an old overcount
});

test('the next book is the furthest read, not the most quizzed (C32.3)', () => {
  const books = [
    { book_id: 'quizzed', chunks_completed: 0, total_chunks: 10, progress_pct: 0, sessions_completed: 5 },
    { book_id: 'read', chunks_completed: 4, total_chunks: 10, progress_pct: 40, sessions_completed: 0 },
    { book_id: 'done', chunks_completed: 10, total_chunks: 10, progress_pct: 100, sessions_completed: 2 },
  ];
  assert.equal(nextBook(books).book_id, 'read');
  assert.equal(nextBook([books[0]]).book_id, 'quizzed'); // nothing read yet: the first unfinished book
});

