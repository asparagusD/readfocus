// A PDF read over HTTP byte ranges (C34.1, issue 11). Supabase Storage answers `Range`
// with 206 but sends no `Accept-Ranges: bytes`, so PDF.js given the URL streams the
// whole file before the first page: 25.9 s for a 29 MB book. Here PDF.js gets a
// PDFDataRangeTransport instead: the first bytes and the length up front, then only the
// ranges the pages it draws need (page 400 of that book after 621 KB, in 1.7 s).
//
// The length comes from a HEAD (the 206's Content-Range is not exposed across origins).
// A server that ignores `Range` and answers 200 gives the whole body, as before. The
// signed URL lives five minutes and pages are now read while the reader reads, so a
// refused range asks `renew` for a fresh URL once and tries again.
//
// C35.8b (issue 19): a PDF that is not linearized keeps its cross-reference table at its end, and PDF.js reads that
// before any page, after the first bytes and the worker's first look. So the file's last range (the one PDF.js
// will ask for, aligned to its `chunk`) is read as soon as the server is known to answer ranges, beside the first.

export const FIRST_BYTES = 256 * 1024; // C35.4: one read for a linearized file's first page (was 64 KB, then more trips)
const NETWORK_TRIES = 3;
const PAUSE_MS = 500;

const rangeHeader = (begin, end) => ({ Range: `bytes=${begin}-${end - 1}` }); // `end` is exclusive, as PDF.js gives it
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lengthOf = (head) => { // the HEAD's Content-Length, or 0 when it failed or gave none
  const length = Number(head?.ok ? head.headers.get('content-length') : NaN);
  return Number.isFinite(length) && length > 0 ? length : 0;
};

/**
 * getDocument's input for `url`: { range, length, ... } when the server answers byte ranges,
 * { data } when it sends the whole file anyway (or the file is smaller than the first read),
 * { url } when the length cannot be learnt. `Transport` is pdfjs.PDFDataRangeTransport.
 */
export async function rangeSource(url, {
  Transport, renew = null, fetch: get = globalThis.fetch, pauseMs = PAUSE_MS, chunk = FIRST_BYTES,
}) {
  let current = url;
  const stop = new AbortController(); // the last-range read, when the server turns out to send whole files
  let tail = null;
  const head = get(url, { method: 'HEAD' }).catch(() => null).then((answer) => {
    const size = lengthOf(answer);
    if (size > FIRST_BYTES) tail = lastRange(size); // as soon as the length is known, beside the first bytes
    return answer;
  });
  let first;
  try {
    [, first] = await Promise.all([head, get(url, { headers: rangeHeader(0, FIRST_BYTES) })]);
  } catch (error) {
    stop.abort();
    throw error;
  }
  if (first.status !== 206) stop.abort();
  if (first.status === 200) return { data: new Uint8Array(await first.arrayBuffer()) };
  if (first.status !== 206) throw new Error(`The book's file could not be read (HTTP ${first.status}).`);
  const bytes = new Uint8Array(await first.arrayBuffer());
  const length = lengthOf(await head);
  if (!length) return { url };
  if (length <= bytes.length) return { data: bytes.slice(0, length) };

  function lastRange(size) {
    const begin = Math.max(FIRST_BYTES, Math.floor((size - 1) / chunk) * chunk);
    return { begin, bytes: read(begin, size, stop.signal).catch(() => null) }; // failed: PDF.js's own request reads it
  }

  /** begin..end, from the tail read when it covers part of it. */
  async function rangeBytes(begin, end) {
    const kept = tail && end > tail.begin ? await tail.bytes : null;
    if (!kept) return read(begin, end);
    const part = kept.subarray(Math.max(begin, tail.begin) - tail.begin, end - tail.begin);
    if (begin >= tail.begin) return part;
    const before = await read(begin, tail.begin);
    const joined = new Uint8Array(end - begin);
    joined.set(before);
    joined.set(part, before.length);
    return joined;
  }

  async function read(begin, end, signal = undefined) {
    let renewed = false;
    for (let attempt = 1; ; attempt += 1) {
      let res;
      try {
        res = await get(current, { headers: rangeHeader(begin, end), signal });
      } catch (error) { // the network: try again after a pause
        if (signal?.aborted || attempt >= NETWORK_TRIES) throw error;
        await pause(pauseMs * attempt);
        continue;
      }
      if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
      if (res.status === 200) return new Uint8Array(await res.arrayBuffer()).slice(begin, end);
      if (renew && !renewed && res.status >= 400 && res.status < 500) { // the signed URL has expired
        renewed = true;
        current = await renew();
        continue;
      }
      throw new Error(`The book's file could not be read (HTTP ${res.status}).`);
    }
  }

  const transport = new Transport(length, bytes);
  transport.requestDataRange = (begin, end) => {
    rangeBytes(begin, end).then((data) => transport.onDataRange(begin, data)).catch(() => {
      // Retries and a renewed URL failed: PDF.js has no error path for a range, so the page that needed
      // these bytes stays unrendered until the book is opened again.
    });
  };
  // Only what the pages drawn need: no background download of the rest competing with them.
  return { range: transport, length, disableAutoFetch: true, disableStream: true };
}
