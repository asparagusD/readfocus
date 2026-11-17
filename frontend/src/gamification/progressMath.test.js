import test from 'node:test';
import assert from 'node:assert/strict';
import { celebratedKey, flameScale, headerLabel, levelOf, share } from './progressMath.js';

test('levels: 250 x n XP from level n to n + 1', () => {
  assert.deepEqual(levelOf(0), { level: 1, into: 0, span: 250 });
  assert.deepEqual(levelOf(249), { level: 1, into: 249, span: 250 });
  assert.deepEqual(levelOf(250), { level: 2, into: 0, span: 500 });
  assert.deepEqual(levelOf(1240), { level: 3, into: 490, span: 750 });
  assert.deepEqual(levelOf(1500), { level: 4, into: 0, span: 1000 });
  assert.deepEqual(levelOf(-5), { level: 1, into: 0, span: 250 });
  assert.deepEqual(levelOf(undefined), { level: 1, into: 0, span: 250 });
});

test('share is clamped to 0..1 and safe with no goal', () => {
  assert.equal(share(30, 50), 0.6);
  assert.equal(share(80, 50), 1);
  assert.equal(share(-1, 50), 0);
  assert.equal(share(5, 0), 0);
});

test('the flame is out before a streak and grows gently to full at 30 days', () => {
  assert.equal(flameScale(0), 0);
  assert.equal(flameScale(1), 0.7);
  assert.ok(flameScale(7) > flameScale(2) && flameScale(7) < 1);
  assert.equal(flameScale(30), 1);
  assert.equal(flameScale(400), 1);
});

const base = { total_xp: 1240, today: { xp: 30, goal: 50, met: false }, streak: { days: 7, freezes: 2 } };

test('the header label reads the level, today, the streak and the freezes', () => {
  assert.equal(headerLabel(base),
    'Level 3, 490 of 750 XP to level 4. Today 30 of 50 XP. 7 days in a row, 2 freezes saved. Open your progress.');
  assert.match(headerLabel({ ...base, today: { xp: 60, goal: 50, met: true } }), /Today's goal is met, 60 XP\./);
  assert.match(headerLabel({ ...base, streak: { days: 1, freezes: 1 } }), /1 day in a row, 1 freeze saved\./);
});

test('a new reader is encouraged, never warned', () => {
  const label = headerLabel({ total_xp: 0, today: { xp: 0, goal: 50, met: false }, streak: { days: 0, freezes: 0 } });
  assert.match(label, /A new streak starts with today’s goal\./);
  assert.doesNotMatch(label, /lose|lost|break|broke|miss|hurry|last chance|don't/i);
});

test('the celebration is remembered per day', () => {
  assert.equal(celebratedKey('2026-11-18'), 'rf-goal-celebrated:2026-11-18');
});

test('the device zone is adopted only while the stored one is the default UTC', async () => {
  const { zoneToAdopt } = await import('./progressMath.js');
  assert.equal(zoneToAdopt('UTC', 'Asia/Dhaka'), 'Asia/Dhaka');
  assert.equal(zoneToAdopt('', 'America/Los_Angeles'), 'America/Los_Angeles');
  assert.equal(zoneToAdopt(null, 'Europe/London'), 'Europe/London');
  assert.equal(zoneToAdopt('Europe/London', 'Asia/Dhaka'), null); // chosen or adopted before: never changed silently
  assert.equal(zoneToAdopt('UTC', 'UTC'), null);
  assert.equal(zoneToAdopt('UTC', 'Etc/UTC'), null);
  assert.equal(zoneToAdopt('UTC', 'Etc/GMT+5'), null); // not a place
  assert.equal(zoneToAdopt('UTC', undefined), null);
  assert.equal(zoneToAdopt('UTC', 'not a zone'), null);
});

test('the device zone is read from the browser, or null', async () => {
  const { deviceZone } = await import('./progressMath.js');
  const zone = deviceZone();
  assert.ok(zone === null || typeof zone === 'string');
});
