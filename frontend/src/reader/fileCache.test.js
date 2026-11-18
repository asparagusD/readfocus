import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedBookFile, forgetCachedBookFile, forgetCachedBookFiles, keepBookFile, keptSource } from './fileCache.js';

/** Cache Storage in memory: open(name) gives a cache with match, put, keys and delete. */
function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(url) { const r = entries.get(String(url)); return r ? r.clone() : undefined; },
        async put(url, response) { entries.set(String(url), response); },
        async keys() { return [...entries.keys()].map((url) => ({ url })); },
        async delete(request) { return entries.delete(request.url ?? String(request)); },
      };
    },
    async delete(name) { return stores.delete(name); },
  };
}

const bytes = (text) => new TextEncoder().encode(text);
const text = (data) => new TextDecoder().decode(data);

function server(body = 'PK epub bytes') {
  const asked = [];
  const fetch = async (url) => { asked.push(url); return new Response(bytes(body)); };
  return { fetch, asked };
}

/** Wait until the copy (written in the background) is there, at most a second. */
async function kept(bookId, sha256, caches) {
  for (let waited = 0; waited < 1000; waited += 5) {
    const found = await cachedBookFile(bookId, sha256, caches);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return null;
}

test('the first open downloads the file and keeps it; the next open reads it from the browser', async () => {
  const caches = fakeCaches();
  const { fetch, asked } = server();
  const first = await keptSource('b1', { url: 'https://s/sign?t=1', sha256: 'aa' }, { fetch, caches });
  assert.equal(text(first.data), 'PK epub bytes');
  await kept('b1', 'aa', caches);
  const second = await keptSource('b1', { url: 'https://s/sign?t=2', sha256: 'aa' }, { fetch, caches });
  assert.equal(text(second.data), 'PK epub bytes');
  assert.deepEqual(asked, ['https://s/sign?t=1']);
});

test('a changed file (another sha256) is downloaded again and replaces the old copy', async () => {
  const caches = fakeCaches();
  await keepBookFile('b1', 'aa', bytes('old'), caches);
  const { fetch, asked } = server('new');
  const source = await keptSource('b1', { url: 'https://s/sign', sha256: 'bb' }, { fetch, caches });
  assert.equal(text(source.data), 'new');
  assert.equal(asked.length, 1);
  assert.equal(text(await kept('b1', 'bb', caches)), 'new');
  assert.equal(await cachedBookFile('b1', 'aa', caches), null);
});

test('a device copy or data is used as it is', async () => {
  const data = bytes('here');
  const { fetch, asked } = server();
  assert.deepEqual(await keptSource('b1', { data }, { fetch, caches: fakeCaches() }), { data });
  assert.deepEqual(asked, []);
});

test('with no Cache Storage the file is simply downloaded', async () => {
  const { fetch, asked } = server();
  const source = await keptSource('b1', { url: 'https://s/sign', sha256: 'aa' }, { fetch, caches: undefined });
  assert.equal(text(source.data), 'PK epub bytes');
  assert.equal(asked.length, 1);
  assert.equal(await keepBookFile('b1', 'aa', bytes('x'), undefined), false);
});

test('a full or broken cache never stops the book opening', async () => {
  const broken = { open: async () => { throw new Error('QuotaExceededError'); }, delete: async () => { throw new Error('no'); } };
  const { fetch } = server();
  const source = await keptSource('b1', { url: 'https://s/sign', sha256: 'aa' }, { fetch, caches: broken });
  assert.equal(text(source.data), 'PK epub bytes');
  await forgetCachedBookFile('b1', broken);
  await forgetCachedBookFiles(broken);
});

test('a refused download is an error, and nothing is kept', async () => {
  const caches = fakeCaches();
  const fetch = async () => new Response('gone', { status: 404 });
  await assert.rejects(keptSource('b1', { url: 'https://s/sign', sha256: 'aa' }, { fetch, caches }), /HTTP 404/);
  assert.equal(await cachedBookFile('b1', 'aa', caches), null);
});

test('removing a book forgets its copy; signing out forgets them all', async () => {
  const caches = fakeCaches();
  await keepBookFile('b1', 'aa', bytes('one'), caches);
  await keepBookFile('b2', 'cc', bytes('two'), caches);
  await forgetCachedBookFile('b1', caches);
  assert.equal(await cachedBookFile('b1', 'aa', caches), null);
  assert.equal(text(await cachedBookFile('b2', 'cc', caches)), 'two');
  await forgetCachedBookFiles(caches);
  assert.equal(await cachedBookFile('b2', 'cc', caches), null);
});
