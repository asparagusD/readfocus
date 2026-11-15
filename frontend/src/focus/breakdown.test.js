import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakdown, minutesOf } from './breakdown.js';

const LINES = [
  { code: 'counted', label: 'Focused reading', seconds: 3120, points: 520 },
  { code: 'page_cap', label: 'Time on one page beyond 30 minutes without turning it', seconds: 600, points: 0 },
  { code: 'quiz_bonus', label: 'Quiz: 2 of 3 correct', points: 40 },
];

test('minutes in words', () => {
  assert.equal(minutesOf(0), '0 minutes');
  assert.equal(minutesOf(20), 'under a minute');
  assert.equal(minutesOf(60), '1 minute');
  assert.equal(minutesOf(3120), '52 minutes');
});

test('a passed quiz: focused time, the time not counted, the bonus and the total', () => {
  const out = breakdown({ passed: true, lines: LINES, quiz_correct: 2, quiz_total: 3, points_total: 560 });
  assert.equal(out.passed, true);
  assert.deepEqual(out.rows.map((r) => [r.title, r.detail, r.value, r.kind]), [
    ['Focused reading', '52 minutes', '+520', 'counted'],
    ['Not counted', 'Time on one page beyond 30 minutes without turning it · 10 minutes', '—', 'void'],
    ['Quiz bonus', '2 of 3 right · 67%', '+40', 'counted'],
    ['Total', 'Points from this session', '+560', 'total'],
  ]);
});

test('under the pass mark: no figures, the total is 0 and the failed line is not a row', () => {
  const lines = [...LINES.slice(0, 2), { code: 'quiz_bonus', label: 'Quiz: 1 of 3 correct', points: 0 },
    { code: 'quiz_failed', label: 'Quiz below 40%: this session earns 0 points', points: 0 }];
  const out = breakdown({ passed: false, lines, quiz_correct: 1, quiz_total: 3, points_total: 0 });
  assert.equal(out.passed, false);
  assert.deepEqual(out.rows.map((r) => [r.title, r.value]), [
    ['Focused reading', '—'], ['Not counted', '—'], ['Quiz', '—'], ['This session', '0'],
  ]);
  assert.equal(out.correct, 1);
  assert.equal(out.total, 3);
});

test('no lines still gives a total', () => {
  assert.deepEqual(breakdown({}).rows.map((r) => r.value), ['0']);
});
