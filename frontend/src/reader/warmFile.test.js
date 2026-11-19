import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WARM_EVERY_MS, warmBookFile } from './warmFile.js';

function setup() {
  const asked = [];
  const fetched = [];
  let t = 1_000_000;
  return {
    asked, fetched,
    clock: { advance: (ms) => { t += ms; } },
    options: {
      api: async (id) => { asked.push(id); return { url: `https://s/sign/${id}?token=t` }; },
      fetch: async (url, init) => { fetched.push([url, init.headers.Range]); return new Response('x', { status: 206 }); },
      now: () => t,
      memo: new Map(),
    },
  };
}

const PDF = { id: 'b1', file_type: 'pdf', storage_mode: 'cloud' };

test('a stored PDF is asked for one byte at its signed URL', async () => {
  const { asked, fetched, options } = setup();
  assert.equal(await warmBookFile(PDF, options), true);
  assert.deepEqual(asked, ['b1']);
  assert.deepEqual(fetched, [['https://s/sign/b1?token=t', 'bytes=0-0']]);
});

test('once in ten minutes per book', async () => {
  const { fetched, clock, options } = setup();
  await warmBookFile(PDF, options);
  clock.advance(WARM_EVERY_MS - 1);
  assert.equal(await warmBookFile(PDF, options), false);
  clock.advance(1);
  await warmBookFile(PDF, options);
  await warmBookFile({ ...PDF, id: 'b2' }, options);
  assert.equal(fetched.length, 3);
});

test('no warm for an EPUB, a device-only book or no book', async () => {
  const { asked, options } = setup();
  for (const book of [{ ...PDF, file_type: 'epub' }, { ...PDF, storage_mode: 'device' }, null]) {
    assert.equal(await warmBookFile(book, options), false);
  }
  assert.deepEqual(asked, []);
});

test('a failure never rejects and is not asked again at once', async () => {
  const { asked, options } = setup();
  options.api = async (id) => { asked.push(id); throw new Error('404'); };
  assert.equal(await warmBookFile(PDF, options), false);
  assert.equal(await warmBookFile(PDF, options), false);
  assert.deepEqual(asked, ['b1']);
});
