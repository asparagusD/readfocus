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

export const FIRST_BYTES = 64 * 1024; // PDF.js's own chunk size; a linearized file's first page is near the start
const NETWORK_TRIES = 3;
const PAUSE_MS = 500;

const rangeHeader = (begin, end) => ({ Range: `bytes=${begin}-${end - 1}` }); // `end` is exclusive, as PDF.js gives it
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * getDocument's input for `url`: { range, length, ... } when the server answers byte ranges,
 * { data } when it sends the whole file anyway (or the file is smaller than the first read),
 * { url } when the length cannot be learnt. `Transport` is pdfjs.PDFDataRangeTransport.
 */
export async function rangeSource(url, { Transport, renew = null, fetch: get = globalThis.fetch, pauseMs = PAUSE_MS }) {
  let current = url;
  const [head, first] = await Promise.all([
    get(url, { method: 'HEAD' }).catch(() => null),
    get(url, { headers: rangeHeader(0, FIRST_BYTES) }),
  ]);
  if (first.status === 200) return { data: new Uint8Array(await first.arrayBuffer()) };
  if (first.status !== 206) throw new Error(`The book's file could not be read (HTTP ${first.status}).`);
  const bytes = new Uint8Array(await first.arrayBuffer());
  const length = Number(head?.ok ? head.headers.get('content-length') : NaN);
  if (!Number.isFinite(length) || length <= 0) return { url };
  if (length <= bytes.length) return { data: bytes.slice(0, length) };

  async function read(begin, end) {
    let renewed = false;
    for (let attempt = 1; ; attempt += 1) {
      let res;
      try {
        res = await get(current, { headers: rangeHeader(begin, end) });
      } catch (error) { // the network: try again after a pause
        if (attempt >= NETWORK_TRIES) throw error;
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
    read(begin, end).then((chunk) => transport.onDataRange(begin, chunk)).catch(() => {
      // Retries and a renewed URL failed: PDF.js has no error path for a range, so the page that needed
      // these bytes stays unrendered until the book is opened again.
    });
  };
  // Only what the pages drawn need: no background download of the rest competing with them.
  return { range: transport, length, disableAutoFetch: true, disableStream: true };
}
