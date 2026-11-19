import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_BYTES, rangeSource } from './rangeSource.js';

const FILE = Uint8Array.from({ length: 300_000 }, (_, i) => i % 251); // a 300 KB "file"
const TAIL = `bytes=${FIRST_BYTES}-${FILE.length - 1}`; // its last 256 KB range, read beside the first (C35.8b)

class FakeTransport {
  constructor(length, initialData) { this.length = length; this.initialData = initialData; this.got = []; }
  onDataRange(begin, chunk) { this.got.push([begin, chunk]); }
}

/** A storage server: HEAD gives the length; GET honours `Range` with 206 unless `ranges` is false. */
function server({ ranges = true, head = true, expiredUrls = new Set(), failTimes = 0, failRange = null, file = FILE } = {}) {
  const calls = [];
  let failures = failTimes;
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, range: init.headers?.Range ?? null, signal: init.signal });
    if (method === 'HEAD') {
      if (!head) throw new TypeError('Failed to fetch');
      return new Response(null, { status: 200, headers: { 'Content-Length': String(file.length) } });
    }
    if (failures > 0 && init.headers?.Range && (failRange ? init.headers.Range === failRange
      : init.headers.Range !== `bytes=0-${FIRST_BYTES - 1}`)) {
      failures -= 1;
      throw new TypeError('Failed to fetch');
    }
    if (expiredUrls.has(url)) return new Response('{"error":"InvalidJWT"}', { status: 400 });
    const match = /bytes=(\d+)-(\d+)/.exec(init.headers?.Range ?? '');
    if (!ranges || !match) return new Response(file, { status: 200 });
    const [begin, last] = [Number(match[1]), Number(match[2])];
    return new Response(file.slice(begin, last + 1), { status: 206 });
  };
  return { fetch, calls };
}

/** Wait until `done()` holds (timers here tick at about 15 ms on Windows), at most a second. */
async function until(done) {
  for (let waited = 0; !done() && waited < 1000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
}

test('a server that answers ranges: the first bytes and the length, then only the ranges asked for', async () => {
  const { fetch, calls } = server();
  const source = await rangeSource('https://s/sign?t=1', { Transport: FakeTransport, fetch });
  assert.equal(source.length, FILE.length);
  assert.equal(source.disableAutoFetch, true);
  assert.equal(source.disableStream, true);
  assert.deepEqual(source.range.initialData, FILE.slice(0, FIRST_BYTES));
  assert.deepEqual(calls.map((c) => [c.method, c.range]), [['HEAD', null], ['GET', `bytes=0-${FIRST_BYTES - 1}`], ['GET', TAIL]]);

  source.range.requestDataRange(200_000, 210_000); // PDF.js's end is exclusive
  await until(() => source.range.got.length === 1);
  assert.equal(calls.at(-1).range, 'bytes=200000-209999');
  assert.deepEqual(source.range.got, [[200_000, FILE.slice(200_000, 210_000)]]);
});

test('a server that ignores Range gives the whole file as data, as before', async () => {
  const { fetch } = server({ ranges: false });
  const source = await rangeSource('https://s/file.pdf', { Transport: FakeTransport, fetch });
  assert.deepEqual(Object.keys(source), ['data']);
  assert.equal(source.data.length, FILE.length);
});

test('a file smaller than the first read is used as data', async () => {
  const small = FILE.slice(0, 10_000);
  const { fetch } = server({ file: small });
  const source = await rangeSource('https://s/small.pdf', { Transport: FakeTransport, fetch });
  assert.deepEqual(source, { data: small });
});

test('with no length (the HEAD failed) PDF.js gets the URL, as before', async () => {
  const { fetch } = server({ head: false });
  const source = await rangeSource('https://s/file.pdf', { Transport: FakeTransport, fetch });
  assert.deepEqual(source, { url: 'https://s/file.pdf' });
});

test('a file the server refuses is an error', async () => {
  const fetch = async () => new Response('gone', { status: 404 });
  await assert.rejects(rangeSource('https://s/x.pdf', { Transport: FakeTransport, fetch }), /HTTP 404/);
});

test('an expired signed URL is renewed once and the range read from the new one', async () => {
  const expiredUrls = new Set();
  const { fetch, calls } = server({ expiredUrls });
  let renewals = 0;
  const renew = async () => { renewals += 1; return 'https://s/sign?t=2'; };
  const source = await rangeSource('https://s/sign?t=1', { Transport: FakeTransport, fetch, renew });
  expiredUrls.add('https://s/sign?t=1'); // five minutes later
  source.range.requestDataRange(100_000, 100_100);
  await until(() => source.range.got.length === 1);
  assert.equal(renewals, 1);
  assert.equal(calls.at(-1).url, 'https://s/sign?t=2');
  assert.deepEqual(source.range.got, [[100_000, FILE.slice(100_000, 100_100)]]);
  source.range.requestDataRange(150_000, 150_010); // the new URL is kept
  await until(() => source.range.got.length === 2);
  assert.equal(renewals, 1);
  assert.equal(calls.at(-1).url, 'https://s/sign?t=2');
});

test('a dropped connection is tried again', async () => {
  const { fetch } = server({ failTimes: 2, failRange: 'bytes=70000-70499' });
  const source = await rangeSource('https://s/f.pdf', { Transport: FakeTransport, fetch, pauseMs: 1 });
  source.range.requestDataRange(70_000, 70_500);
  await until(() => source.range.got.length > 0);
  assert.deepEqual(source.range.got, [[70_000, FILE.slice(70_000, 70_500)]]);
});

test('the last range is read beside the first, and PDF.js asking for it makes no second request (C35.8b)', async () => {
  const { fetch, calls } = server();
  const source = await rangeSource('https://s/f.pdf', { Transport: FakeTransport, fetch });
  source.range.requestDataRange(FIRST_BYTES, FILE.length); // where a non-linearized PDF keeps its xref
  source.range.requestDataRange(290_000, 300_000); // a part of it
  await until(() => source.range.got.length === 2);
  assert.equal(calls.filter((c) => c.range === TAIL).length, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(source.range.got, [[FIRST_BYTES, FILE.slice(FIRST_BYTES)], [290_000, FILE.slice(290_000)]]);
});

test('a range that starts before the last one reads only the part before it', async () => {
  const big = Uint8Array.from({ length: 700_000 }, (_, i) => i % 13);
  const { fetch, calls } = server({ file: big });
  const source = await rangeSource('https://s/f.pdf', { Transport: FakeTransport, fetch, chunk: 128 * 1024 });
  const tailBegin = 5 * 128 * 1024; // 655360, the last 128 KB chunk
  assert.equal(calls[2].range, `bytes=${tailBegin}-${big.length - 1}`);
  source.range.requestDataRange(600_000, big.length);
  await until(() => source.range.got.length === 1);
  assert.equal(calls.at(-1).range, `bytes=600000-${tailBegin - 1}`);
  assert.deepEqual(source.range.got, [[600_000, big.slice(600_000)]]);
});

test('a failed read of the last range leaves PDF.js to read it itself', async () => {
  const { fetch, calls } = server({ failTimes: 3, failRange: TAIL });
  const source = await rangeSource('https://s/f.pdf', { Transport: FakeTransport, fetch, pauseMs: 1 });
  source.range.requestDataRange(FIRST_BYTES, FILE.length);
  await until(() => source.range.got.length === 1);
  assert.equal(calls.filter((c) => c.range === TAIL).length, 4); // three tries beside the first, then PDF.js's own
  assert.deepEqual(source.range.got, [[FIRST_BYTES, FILE.slice(FIRST_BYTES)]]);
});

test('no last-range read when the length is unknown; a server that sends whole files has it stopped', async () => {
  const unknown = server({ head: false });
  await rangeSource('https://s/f.pdf', { Transport: FakeTransport, fetch: unknown.fetch });
  assert.equal(unknown.calls.filter((c) => c.method === 'GET').length, 1);

  const whole = server({ ranges: false });
  await rangeSource('https://s/f.pdf', { Transport: FakeTransport, fetch: whole.fetch });
  const tail = whole.calls.find((c) => c.range === TAIL);
  assert.equal(tail.signal.aborted, true);
});

test('a failed first read stops the last-range read', async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(init);
    if (init.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Length': '300000' } });
    if (init.headers.Range === `bytes=0-${FIRST_BYTES - 1}`) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new TypeError('Failed to fetch');
    }
    return new Promise(() => {}); // the tail, never answered
  };
  await assert.rejects(rangeSource('https://s/f.pdf', { Transport: FakeTransport, fetch }), /Failed to fetch/);
  assert.equal(calls.find((c) => c.headers?.Range === TAIL).signal.aborted, true);
});
