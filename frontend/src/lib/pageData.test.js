import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, forgetPageData, load, remember } from './pageData.js';

test('an answer is kept for its path, and the last one wins', async () => {
  forgetPageData();
  assert.equal(cached('/books'), undefined);
  await load('/books', { api: async () => ['a'] });
  assert.deepEqual(cached('/books'), ['a']);
  await load('/books', { api: async () => ['a', 'b'] });
  assert.deepEqual(cached('/books'), ['a', 'b']);
});

test('a request already on its way is shared, not sent twice', async () => {
  forgetPageData();
  let asked = 0;
  let answer;
  const api = () => { asked += 1; return new Promise((resolve) => { answer = resolve; }); };
  const first = load('/dashboard', { api });
  const second = load('/dashboard', { api });
  answer({ ok: 1 });
  assert.deepEqual(await first, { ok: 1 });
  assert.deepEqual(await second, { ok: 1 });
  assert.equal(asked, 1);
  await load('/dashboard', { api: async () => ({ ok: 2 }) }); // once answered, the next load asks again
  assert.deepEqual(cached('/dashboard'), { ok: 2 });
});

test('a failure keeps the last data and lets the next load try again', async () => {
  forgetPageData();
  remember('/leagues/current', { tier: 'Bronze' });
  await assert.rejects(load('/leagues/current', { api: async () => { throw new Error('down'); } }));
  assert.deepEqual(cached('/leagues/current'), { tier: 'Bronze' });
  await load('/leagues/current', { api: async () => ({ tier: 'Silver' }) });
  assert.deepEqual(cached('/leagues/current'), { tier: 'Silver' });
});

test('signing out forgets every page', async () => {
  remember('/books', ['a']);
  remember('/me/progress', { xp: 3 });
  forgetPageData();
  assert.equal(cached('/books'), undefined);
  assert.equal(cached('/me/progress'), undefined);
});

test('with `fresh`, a young answer is used and nothing is asked; an older one is asked again', async () => {
  forgetPageData();
  let clock = 1000;
  const now = () => clock;
  let asked = 0;
  const api = async () => { asked += 1; return { xp: asked }; };
  await load('/me/progress', { api, now });
  clock = 5000;
  assert.deepEqual(await load('/me/progress', { api, now, fresh: 5000 }), { xp: 1 });
  assert.equal(asked, 1);
  clock = 7000;
  assert.deepEqual(await load('/me/progress', { api, now, fresh: 5000 }), { xp: 2 });
});
