import test from 'node:test';
import assert from 'node:assert/strict';
import { changes, initials, lastWeekLine, ordinal, tierStates, timeLeft, withMarkers } from './leagueView.js';

const NOW = new Date('2026-11-18T15:00:00Z');

test('time left to Monday 00:00 UTC', () => {
  assert.equal(timeLeft('2026-11-23T00:00:00+00:00', NOW), '4 days, 9 hours left');
  assert.equal(timeLeft('2026-11-19T15:00:00+00:00', NOW), '1 day left');
  assert.equal(timeLeft('2026-11-18T18:30:00+00:00', NOW), '3 hours left');
  assert.equal(timeLeft('2026-11-18T15:20:00+00:00', NOW), 'Less than an hour left');
  assert.equal(timeLeft('2026-11-18T14:00:00+00:00', NOW), 'The new week starts now');
});

test('ordinals and initials', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
  assert.equal(initials('Quiet Owl'), 'QO');
  assert.equal(initials('Reader 3f2a'), 'R3');
  assert.equal(initials('heron'), 'HE');
  assert.equal(initials('Zoë 🦉'), 'Z🦉');
  assert.equal(initials(''), '·');
});

test('tier chips: done below, current, the next one, later', () => {
  assert.deepEqual(tierStates('Hardcover').map((t) => t.state), ['done', 'done', 'current', 'next', 'later', 'later']);
  assert.deepEqual(tierStates('Illuminated').map((t) => t.state), ['done', 'done', 'done', 'done', 'done', 'current']);
});

const rows = (...ranks) => ranks.map((rank) => ({ id: `r${rank}`, rank }));
const kinds = (items) => items.map((i) => i.marker ?? i.rank);

test('a full group: the promotion line after rank 7, the demotion line before rank 26', () => {
  const items = withMarkers(rows(...Array.from({ length: 30 }, (_, i) => i + 1)), { size: 30, promote: 7, demote: 5 }, 'Hardcover');
  const k = kinds(items);
  assert.equal(k[7], 'promotion');
  assert.deepEqual(items[7], { marker: 'promotion', count: 7, to: 'Folio' });
  assert.equal(k.indexOf('demotion'), k.indexOf(26) - 1);
  assert.deepEqual(items[k.indexOf('demotion')], { marker: 'demotion', count: 5, to: 'Paperback' });
});

test('hidden readers leave a gap, and markers follow ranks', () => {
  assert.deepEqual(kinds(withMarkers(rows(1, 3, 4), { size: 4, promote: 1, demote: 0 }, 'Folio')), [1, 'promotion', 'gap', 3, 4]);
  assert.deepEqual(kinds(withMarkers(rows(2, 3), { size: 4, promote: 1, demote: 0 }, 'Folio')), ['gap', 2, 3]);
});

test('no promotion line in Illuminated, no demotion line in Pamphlet or a small group', () => {
  const twelve = rows(...Array.from({ length: 12 }, (_, i) => i + 1));
  const zones = { size: 12, promote: 3, demote: 2 };
  assert.ok(!kinds(withMarkers(twelve, zones, 'Illuminated')).includes('promotion'));
  assert.ok(kinds(withMarkers(twelve, zones, 'Illuminated')).includes('demotion'));
  assert.ok(!kinds(withMarkers(twelve, zones, 'Pamphlet')).includes('demotion'));
  assert.ok(!kinds(withMarkers(rows(1, 2, 3, 4), { size: 4, promote: 1, demote: 0 }, 'Folio')).includes('demotion'));
});

test('last week in a sentence that never scolds', () => {
  const last = { rank: 2, size: 12, weekly_xp: 180, tier: 'Paperback', now_in: 'Hardcover', outcome: 'promoted' };
  assert.equal(lastWeekLine(last), 'Last week you came 2nd of 12 with 180 XP and moved up to Hardcover.');
  assert.equal(lastWeekLine({ ...last, outcome: 'stayed', now_in: 'Paperback' }),
    'Last week you came 2nd of 12 with 180 XP and stayed in Paperback.');
  const down = lastWeekLine({ ...last, rank: 11, outcome: 'demoted', now_in: 'Pamphlet' });
  assert.equal(down, 'Last week you came 11th of 12 with 180 XP. This week you read in Pamphlet, a fresh start.');
  assert.doesNotMatch(down, /lost|fell|failed|dropped|relegat/i);
  assert.equal(lastWeekLine(null), null);
});

test('a save sends only what changed; an emptied name clears it', () => {
  const saved = { display_name: 'Owl', daily_goal: 50, leaderboard_opt_out: false };
  const draft = (over) => ({ display_name: 'Owl', daily_goal: '50', leaderboard_opt_out: false, ...over });
  assert.deepEqual(changes(saved, draft({})), {});
  assert.deepEqual(changes(saved, draft({ display_name: '  Quiet   Owl ' })), { display_name: 'Quiet Owl' });
  assert.deepEqual(changes(saved, draft({ display_name: '  ' })), { display_name: null });
  assert.deepEqual(changes(saved, draft({ daily_goal: '120', leaderboard_opt_out: true })), { daily_goal: 120, leaderboard_opt_out: true });
  assert.deepEqual(changes({ ...saved, display_name: null }, draft({ display_name: '' })), {});
});
