import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardContent, createLookupClient, readLookupOn, storeLookupOn } from './lookup.js';

const RUN = {
  term: 'run', phonetic: '/ɹʌn/', audio_url: null, source: 'dictionary', found: true, ambiguous: false, url: null, wiki: null,
  meanings: [
    { part_of_speech: 'verb', definitions: ['To move swiftly.', 'To flee.'], example: 'Run to the shop.' },
    { part_of_speech: 'noun', definitions: ['An act of running.'], example: null },
  ],
};
const POND = {
  term: 'walden pond', source: 'wikipedia', found: true, ambiguous: false, meanings: [], phonetic: null,
  url: 'https://en.wikipedia.org/wiki/Walden_Pond',
  wiki: { title: 'Walden Pond', description: 'Lake in Concord, Massachusetts', extract: 'Walden Pond is a lake. Thoreau lived there.',
    url: 'https://en.wikipedia.org/wiki/Walden_Pond', thumbnail_url: null },
};

/** A fake fetchApi: answers by path after a tick, records requests and their signals. */
function fakeApi(answers) {
  const calls = [];
  const api = (path, { signal } = {}) => {
    calls.push({ path, signal });
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        const answer = answers[path];
        return answer instanceof Error ? reject(answer) : resolve(answer);
      }, 1);
    });
  };
  return { api, calls };
}

test('the client asks once per term and serves repeats from its cache', async () => {
  const { api, calls } = fakeApi({ '/lookup?term=run&lang=en': RUN });
  const client = createLookupClient(api);
  const first = await client.get({ term: 'Run', proper: false });
  const second = await client.get({ term: 'run', proper: false });
  assert.deepEqual(first, { status: 'ready', data: RUN });
  assert.equal(second.data, RUN);
  assert.equal(calls.length, 1);
});

test('a name and a common word are cached apart (proper=1)', async () => {
  const { api, calls } = fakeApi({ '/lookup?term=Mercury&lang=en&proper=1': POND, '/lookup?term=mercury&lang=en': RUN });
  const client = createLookupClient(api);
  await client.get({ term: 'Mercury', proper: true });
  await client.get({ term: 'mercury', proper: false });
  assert.deepEqual(calls.map((c) => c.path), ['/lookup?term=Mercury&lang=en&proper=1', '/lookup?term=mercury&lang=en']);
});

test('a newer lookup aborts the older one, which resolves as aborted', async () => {
  const { api, calls } = fakeApi({ '/lookup?term=run&lang=en': RUN, '/lookup?term=Walden+Pond&lang=en&proper=1': POND });
  const client = createLookupClient(api);
  const older = client.get({ term: 'run', proper: false });
  const newer = client.get({ term: 'Walden Pond', proper: true });
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(await older, { status: 'aborted' });
  assert.equal((await newer).data, POND);
  await client.get({ term: 'run', proper: false }); // the aborted one was not cached
  assert.equal(calls.length, 3);
});

test('the same term asked twice while in flight makes one request', async () => {
  const { api, calls } = fakeApi({ '/lookup?term=run&lang=en': RUN });
  const client = createLookupClient(api);
  const [a, b] = await Promise.all([client.get({ term: 'run' }), client.get({ term: 'run' })]);
  assert.equal(a.data, RUN);
  assert.equal(b.data, RUN);
  assert.equal(calls.length, 1);
});

test('failures and "unavailable" answers are not cached', async () => {
  const busy = { term: 'slow', found: false, unavailable: true, message: "We couldn't look this up right now." };
  const { api, calls } = fakeApi({ '/lookup?term=slow&lang=en': busy, '/lookup?term=oops&lang=en': new Error('Slow down') });
  const client = createLookupClient(api);
  assert.equal((await client.get({ term: 'slow' })).status, 'ready');
  await client.get({ term: 'slow' });
  assert.deepEqual(await client.get({ term: 'oops' }), { status: 'error', message: 'Slow down' });
  await client.get({ term: 'oops' });
  assert.equal(calls.length, 4);
});

test('the cache keeps the most recent terms only', async () => {
  const answers = Object.fromEntries(['one', 'two', 'three'].map((t) => [`/lookup?term=${t}&lang=en`, { ...RUN, term: t }]));
  const { api, calls } = fakeApi(answers);
  const client = createLookupClient(api, { size: 2 });
  for (const term of ['one', 'two', 'one', 'three']) await client.get({ term }); // "two" is the oldest now
  await client.get({ term: 'one' });
  await client.get({ term: 'two' });
  assert.deepEqual(calls.map((c) => c.path.match(/term=(\w+)/)[1]), ['one', 'two', 'three', 'two']);
});

test('the hover setting is on by default, kept per user, and survives broken storage', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readLookupOn('user-a', storage), true);
  storeLookupOn('user-a', false, storage);
  assert.equal(readLookupOn('user-a', storage), false);
  assert.equal(readLookupOn('user-b', storage), true);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readLookupOn('user-a', broken), true);
  assert.doesNotThrow(() => storeLookupOn('user-a', false, broken));
});

test('cardContent: a definition shows one part of speech, two senses and an example', () => {
  assert.deepEqual(cardContent({ status: 'ready', data: RUN }, { term: 'runs', kind: 'word' }), {
    kind: 'definition', title: 'run', phonetic: '/ɹʌn/', pos: 'verb', senses: ['To move swiftly.', 'To flee.'],
    example: 'Run to the shop.', announce: 'run, verb: To move swiftly.',
  });
});

test('cardContent: a summary keeps the title, description, extract and link', () => {
  const card = cardContent({ status: 'ready', data: POND }, { term: 'Walden Pond', kind: 'phrase' });
  assert.equal(card.kind, 'summary');
  assert.equal(card.title, 'Walden Pond');
  assert.equal(card.description, 'Lake in Concord, Massachusetts');
  assert.equal(card.url, 'https://en.wikipedia.org/wiki/Walden_Pond');
  assert.equal(card.announce, 'Walden Pond: Walden Pond is a lake. Thoreau lived there.');
});

test('cardContent: ambiguous, not found, unavailable, error and loading', () => {
  const ambiguous = { ...POND, wiki: null, ambiguous: true, url: 'https://en.wikipedia.org/wiki/Mercury' };
  assert.equal(cardContent({ status: 'ready', data: ambiguous }, { term: 'Mercury' }).kind, 'ambiguous');
  const none = { term: 'velvet cushion', found: false, meanings: [], wiki: null, ambiguous: false };
  assert.deepEqual(cardContent({ status: 'ready', data: none }, { term: 'velvet cushion', kind: 'phrase' }), {
    kind: 'none', title: 'velvet cushion', phrase: true, announce: 'No definition found for velvet cushion.',
  });
  const busy = { term: 'slow', found: false, unavailable: true, message: "We couldn't look this up right now." };
  assert.equal(cardContent({ status: 'ready', data: busy }, { term: 'slow' }).kind, 'unavailable');
  assert.deepEqual(cardContent({ status: 'error', message: 'Slow down' }, { term: 'slow' }),
    { kind: 'unavailable', title: 'slow', message: 'Slow down', announce: "Couldn't look up slow: Slow down" });
  assert.deepEqual(cardContent({ status: 'loading' }, { term: 'slow' }), { kind: 'loading', title: 'slow', announce: '' });
});
