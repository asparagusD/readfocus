/**
 * Save a copy with my marks, off the page (C40.8): pdf-lib writes the copy here, so the reader's page keeps drawing
 * while it works (on C39.9's marked 300-page book it stood still for about 0.77 s on the main thread). It receives
 * { bytes, annotations, marks, colours } with the file's bytes transferred and the colours already resolved (they are
 * read from CSS tokens, which only the page has), and answers { ok: true, out } with the copy transferred back, or
 * { ok: false, code: 'encrypted', bytes } (the file handed back untouched) or { ok: false, code: 'failed', message }.
 */
import { EncryptedPdfError, markedCopy } from './saveCopy.js';

const lookup = (table) => (name) => table?.[name] ?? '';

self.onmessage = async ({ data }) => {
  const { bytes, annotations, marks, colours } = data;
  try {
    const out = await markedCopy(bytes, {
      annotations, marks,
      colours: { highlight: lookup(colours.highlight), underline: lookup(colours.underline), mark: lookup(colours.mark) },
    });
    self.postMessage({ ok: true, out }, [out.buffer]);
  } catch (error) {
    if (error instanceof EncryptedPdfError) self.postMessage({ ok: false, code: 'encrypted', bytes }, [bytes.buffer]);
    else self.postMessage({ ok: false, code: 'failed', message: String(error?.message ?? error) });
  }
};
