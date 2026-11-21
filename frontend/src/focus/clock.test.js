import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerLapsed, idleDue, noticeDue, pageKey, placePosition, shownSeconds, spokenTime, stopwatch } from './clock.js';

test('the stopwatch reads mm:ss under an hour, then h:mm', () => {
  assert.equal(stopwatch(0), '00:00');
  assert.equal(stopwatch(65), '01:05');
  assert.equal(stopwatch(3599), '59:59');
  assert.equal(stopwatch(3600), '1:00');
  assert.equal(stopwatch(9903), '2:45');
  assert.equal(stopwatch(-5), '00:00');
});

test('screen readers hear words, not digits', () => {
  assert.equal(spokenTime(0), 'no time yet');
  assert.equal(spokenTime(61), '1 minute');
  assert.equal(spokenTime(3720), '1 hour 2 minutes');
  assert.equal(spokenTime(7200), '2 hours');
});

test('between server reads the display runs on from the last one, and never past the cap', () => {
  assert.equal(shownSeconds({ base: 600, readAt: 1_000, now: 31_400, ticking: true }), 630);
  assert.equal(shownSeconds({ base: 600, readAt: 1_000, now: 31_400, ticking: false }), 600);
  assert.equal(shownSeconds({ base: 10_790, readAt: 0, now: 60_000, ticking: true }), 10_800);
});

test('the idle prompt comes after ten minutes without input; its answer window is a minute', () => {
  assert.equal(idleDue(0, 599_999), false);
  assert.equal(idleDue(0, 600_000), true);
  assert.equal(answerLapsed(1_000, 60_999), false);
  assert.equal(answerLapsed(1_000, 61_000), true);
});

test('the session notice comes at 2 h 45', () => {
  assert.equal(noticeDue(9899), false);
  assert.equal(noticeDue(9900), true);
});

test('page keys and positions for the events', () => {
  assert.equal(pageKey({ kind: 'pdf', pages: [12, 13] }), 'p12');
  assert.equal(pageKey({ kind: 'epub', index: 3, charStart: 4210 }), 's3:4210');
  assert.equal(pageKey(null), null);
  // C38.1: a scrolled book's page is the one most in view, not the first with some of it in view
  assert.equal(pageKey({ kind: 'pdf', pages: [12, 13], main: 13 }), 'p13');
  assert.equal(pageKey({ kind: 'epub', index: 3, charStart: 4210, main: 42 }), 'l42');
  assert.equal(pageKey({ kind: 'epub', index: 0, charStart: 0, main: 1 }), 'l1');
  assert.equal(placePosition({ kind: 'pdf', pages: [12, 13] }), 12_000_000);
  assert.equal(placePosition({ kind: 'epub', index: 3, charStart: 4210 }), 3_004_210);
  assert.equal(placePosition({ kind: 'epub', index: 3, charStart: 5_000_000 }), 3_999_999);
});
