import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave } from './autosave.js';
import { memoryStore, createQueue } from './queue.js';

/** Timers the test moves by hand. */
function clock() {
  let now = 0;
  const timers = new Map();
  let next = 1;
  return {
    schedule: (fn, ms) => { timers.set(next, { at: now + ms, fn }); return next++; },
    cancel: (id) => timers.delete(id),
    async tick(ms) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) { timers.delete(id); t.fn(); }
      }
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

function setup(save) {
  const time = clock();
  const queue = createQueue(memoryStore());
  const seen = [];
  const autosave = createAutosave({ save, queue, delay: 800, schedule: time.schedule, cancel: time.cancel,
    onChange: (id, s) => seen.push([id, s.status]) });
  return { time, queue, autosave, seen };
}

const failure = (status, detail) => Object.assign(new Error('x'), { status, detail });

test('edits wait 800 ms after the last one, then one save carries the latest content', async () => {
  const calls = [];
  const { time, autosave } = setup(async (id, change, version) => { calls.push([id, change, version]); return { version: version + 1 }; });
  autosave.track('n1', 3);
  autosave.edit('n1', { content: { a: 1 } });
  await time.tick(500);
  autosave.edit('n1', { content: { a: 2 } });
  await time.tick(799);
  assert.deepEqual(calls, []);
  assert.equal(autosave.status('n1').status, 'unsaved');
  await time.tick(1);
  assert.deepEqual(calls, [['n1', { content: { a: 2 } }, 3]]);
  assert.equal(autosave.status('n1').status, 'saved');
  autosave.edit('n1', { content: { a: 3 } });
  await time.tick(800);
  assert.deepEqual(calls[1], ['n1', { content: { a: 3 } }, 4]); // the version the server returned
});

test('flush saves at once; an edit during a save is sent after it with the new version', async () => {
  let release;
  const calls = [];
  const { time, autosave } = setup((id, change, version) => {
    calls.push([change.content, version]);
    return calls.length === 1 ? new Promise((r) => { release = () => r({ version: version + 1 }); }) : Promise.resolve({ version: version + 1 });
  });
  autosave.track('n1', 1);
  autosave.edit('n1', { content: 'one' });
  autosave.flush('n1');
  await time.tick(0);
  assert.equal(autosave.status('n1').status, 'saving');
  autosave.edit('n1', { content: 'two' });
  autosave.flush('n1'); // still saving: it waits
  assert.equal(calls.length, 1);
  release();
  await time.tick(0);
  assert.deepEqual(calls, [['one', 1], ['two', 2]]);
  await time.tick(0);
  assert.equal(autosave.status('n1').status, 'saved');
});

test('offline: the change goes to the queue and is sent again on retry', async () => {
  let online = false;
  const calls = [];
  const { time, autosave, queue } = setup(async (id, change, version) => {
    calls.push(version);
    if (!online) throw new TypeError('Failed to fetch');
    return { version: version + 1 };
  });
  autosave.track('n1', 2);
  autosave.edit('n1', { content: 'draft' });
  await time.tick(800);
  assert.equal(autosave.status('n1').status, 'offline');
  assert.deepEqual(await queue.all(), [{ id: 'n1', change: { content: 'draft' }, version: 2 }]);
  online = true;
  await autosave.retry();
  await time.tick(0);
  assert.equal(autosave.status('n1').status, 'saved');
  assert.deepEqual(await queue.all(), []);
  assert.deepEqual(calls, [2, 2]);
});

test('a queued change from an earlier visit is sent with its own version', async () => {
  const calls = [];
  const { time, autosave, queue } = setup(async (id, change, version) => { calls.push([id, change, version]); return { version: version + 1 }; });
  await queue.put({ id: 'old', change: { content: 'kept' }, version: 5 });
  await autosave.retry();
  await time.tick(0);
  assert.deepEqual(calls, [['old', { content: 'kept' }, 5]]);
  assert.deepEqual(await queue.all(), []);
});

test('a queued change keeps its own version even when the list loaded a newer one', async () => {
  const calls = [];
  const { time, autosave, queue } = setup(async (id, change, version) => { calls.push(version); throw failure(409, { version: 3 }); });
  autosave.track('n1', 3); // the list, after another tab saved twice
  await queue.put({ id: 'n1', change: { content: 'mine' }, version: 1 });
  await autosave.retry();
  await time.tick(0);
  assert.deepEqual(calls, [1]);
  assert.deepEqual(autosave.status('n1'), { status: 'conflict', serverVersion: 3 });
});

test('a 409 is a conflict: nothing is resent until the reader chooses', async () => {
  const calls = [];
  const { time, autosave } = setup(async (id, change, version) => {
    calls.push(version);
    if (version === 1) throw failure(409, { message: 'changed', version: 4 });
    return { version: version + 1 };
  });
  autosave.track('n1', 1);
  autosave.edit('n1', { content: 'mine' });
  await time.tick(800);
  assert.deepEqual(autosave.status('n1'), { status: 'conflict', serverVersion: 4 });
  autosave.edit('n1', { content: 'mine 2' });
  await time.tick(800);
  assert.deepEqual(calls, [1]);
  autosave.keepMine('n1');
  await time.tick(0);
  assert.deepEqual(calls, [1, 4]);
  assert.equal(autosave.status('n1').status, 'saved');
});

test('a refused change (4xx) is an error and is not queued', async () => {
  const { time, autosave, queue } = setup(async () => { throw failure(422, 'bad'); });
  autosave.track('n1', 1);
  autosave.edit('n1', { content: 'x' });
  await time.tick(800);
  assert.equal(autosave.status('n1').status, 'error');
  assert.deepEqual(await queue.all(), []);
});

test('pending() lists notes with unsaved edits; forget() drops one', async () => {
  const { autosave } = setup(async (id, change, version) => ({ version: version + 1 }));
  autosave.track('a', 1);
  autosave.track('b', 1);
  autosave.edit('a', { content: 1 });
  assert.deepEqual(autosave.pending(), ['a']);
  autosave.forget('a');
  assert.deepEqual(autosave.pending(), []);
});
