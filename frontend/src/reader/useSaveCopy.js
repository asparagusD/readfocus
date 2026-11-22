import { useCallback, useRef, useState } from 'react';
import { fetchApi } from '../lib/api';
import { useToast } from '../components/ui/toastContext';
import { chapterFor, marksMarkdown } from './marksMarkdown';
import { colourTables } from './saveCopy';

const MARK_PAGES = 100; // pages of marks asked for at a time (the API returns at most 5,000 a request)

/** A file name for the copy: the title without the characters a file system refuses. */
export const copyName = (title, ext = 'pdf', what = 'with my marks') => `${String(title || 'Book').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)} (${what}).${ext}`;
/** Our colour names as Paper's CSS colours (a published page is light), read from the tokens. */
export function paperColours(doc = document) {
  const probe = doc.createElement('span');
  probe.setAttribute('data-theme', 'paper');
  probe.hidden = true;
  doc.body.append(probe);
  const read = (attr, name, prop) => {
    probe.setAttribute(attr, name);
    return getComputedStyle(probe).getPropertyValue(prop).trim();
  };
  const cache = new Map();
  const of = (attr, prop) => (name) => {
    const key = `${attr}|${name}|${prop}`;
    if (!cache.has(key)) cache.set(key, read(attr, name, prop));
    return cache.get(key);
  };
  const colours = { highlight: of('data-colour', '--c-hl'), underline: of('data-colour', '--c-ul'), mark: of('data-mark-colour', '--c-mark') };
  return { colours, done: () => probe.remove() };
}

/**
 * C40.8: saveCopy.markedCopy in a module worker, so the page keeps drawing while pdf-lib writes ({ out, encrypted }).
 * `bytes` is transferred to it, and an encrypted file comes back untouched. Where the browser has no workers, or the
 * worker cannot start, it runs here as before, on the file read again (`again()`: the first bytes went to the worker).
 */
async function writeCopy(bytes, payload, again) {
  if (typeof Worker === 'function') {
    let worker;
    try {
      worker = new Worker(new URL('./saveCopy.worker.js', import.meta.url), { type: 'module' });
      const reply = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => resolve(data);
        worker.onerror = (event) => { event.preventDefault?.(); reject(new Error(event.message || 'worker failed')); };
        worker.postMessage({ bytes, ...payload }, [bytes.buffer]);
      });
      if (reply.ok) return { out: reply.out, encrypted: false };
      if (reply.code === 'encrypted') return { out: reply.bytes, encrypted: true };
      throw new Error(reply.message);
    } catch (error) {
      if (!worker || error?.message !== 'worker failed') throw error; // the copy failed, not the worker
      console.warn('save a copy: the worker did not start; writing it on the page');
      bytes = await again();
    } finally {
      worker?.terminate();
    }
  }
  const { EncryptedPdfError, markedCopy } = await import('./saveCopy.js');
  const lookup = (table) => (name) => table[name] ?? '';
  const { highlight, underline, mark } = payload.colours;
  try {
    return { out: await markedCopy(bytes, { ...payload, colours: { highlight: lookup(highlight), underline: lookup(underline), mark: lookup(mark) } }), encrypted: false };
  } catch (error) {
    if (error instanceof EncryptedPdfError) return { out: bytes, encrypted: true };
    throw error;
  }
}

/** Hands `blob` to the reader: into the file chosen with Save as, else as a download. */
async function deliver(blob, name, handle) {
  if (handle) {
    const out = await handle.createWritable();
    await out.write(blob);
    await out.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Save and Save as a copy with my marks (C40.4c, issue 24, D2), as Edge's: a PDF with the reader's highlights,
 * underlines, comments, ink and text boxes written in (saveCopy.js, with pdf-lib loaded only now). Save downloads it;
 * Save as asks where first (the browser's file picker, where it has one: asked before anything else, while the click
 * still counts). An encrypted PDF downloads as published, with a note. `reader` is the Reader's ref.
 * C40.4d: an EPUB reflows, so its copy is its highlights and comments as Markdown (marksMarkdown.js), chapter by chapter.
 * C40.5: `print()` too (below). C40.8: pdf-lib writes the copy in a worker (writeCopy), so the page keeps drawing.
 */
export function useSaveCopy({ bookId, kind, title, reader, annotations, pageCount }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const canPick = typeof globalThis.showSaveFilePicker === 'function';

  /** The PDF with my marks written in: { out, marked } (an encrypted file is the book as published, with a note). */
  const pdfCopy = useCallback(async (use) => {
    const probe = paperColours();
    try {
      const marks = [];
      for (let first = 1; first <= Math.max(1, pageCount); first += MARK_PAGES) {
        const data = await fetchApi(`/books/${bookId}/marks?first=${first}&last=${first + MARK_PAGES - 1}`);
        marks.push(...(data?.marks ?? []));
      }
      const read = async () => {
        const bytes = await reader.current?.fileBytes();
        if (!bytes) throw new Error('The book is not open yet.');
        return bytes;
      };
      const list = annotations ?? [];
      const { out, encrypted } = await writeCopy(await read(), { annotations: list, marks,
        colours: colourTables(probe.colours, list, marks) }, read);
      if (!encrypted) return { out, marked: true };
      toast({ kind: 'warning', message: `This PDF is locked against changes, so the ${use === 'print' ? 'print' : 'copy'} is the book as published, without your marks.` });
      return { out, marked: false };
    } finally {
      probe.done();
    }
  }, [bookId, pageCount, reader, annotations, toast]);

  const save = useCallback(async (as = false) => {
    if (working.current) return;
    const epub = kind === 'epub';
    const name = epub ? copyName(title, 'md', 'my highlights') : copyName(title);
    let handle = null;
    if (as && canPick) {
      try {
        handle = await globalThis.showSaveFilePicker({ suggestedName: name, types: [epub
          ? { description: 'Markdown', accept: { 'text/markdown': ['.md'] } } : { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      } catch (error) {
        if (error?.name === 'AbortError') return; // the reader closed the picker
      }
    }
    working.current = true;
    setBusy(true);
    if (epub) {
      try {
        const toc = reader.current?.toc() ?? [];
        const text = marksMarkdown({ title, annotations: (annotations ?? []).filter((a) => a.anchors?.[0]?.kind === 'epub'),
          chapterOf: (a) => chapterFor(toc, a), pageOf: (a) => reader.current?.pageLabel(a) ?? '' });
        await deliver(new Blob([text], { type: 'text/markdown' }), name, handle);
        toast({ kind: 'success', message: handle ? `Saved ${handle.name ?? name}.` : `Saved your highlights: ${name}` });
      } catch (error) {
        console.warn('save highlights failed', error);
        toast({ kind: 'warning', message: "Your highlights weren't saved. Try again." });
      } finally {
        working.current = false;
        setBusy(false);
      }
      return;
    }
    try {
      const { out, marked } = await pdfCopy('copy');
      await deliver(new Blob([out], { type: 'application/pdf' }), name, handle);
      if (marked) toast({ kind: 'success', message: handle ? `Saved ${handle.name ?? name}.` : `Saved a copy with your marks: ${name}` });
    } catch (error) {
      console.warn('save a copy failed', error);
      toast({ kind: 'warning', message: "The copy wasn't saved. Try again." });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, [kind, title, canPick, reader, annotations, toast, pdfCopy]);

  /**
   * C40.5 (issue 24): Print, as Edge's: a PDF prints the copy with my marks from a hidden frame (the browser's own
   * PDF viewer; where a frame cannot print, the copy opens in a new tab to print from); an EPUB prints the chapter on
   * screen, its highlights with it.
   */
  const print = useCallback(async () => {
    if (working.current) return;
    if (kind === 'epub') {
      const win = reader.current?.documents()?.find((doc) => doc.defaultView)?.defaultView;
      if (win) win.print();
      else toast({ kind: 'warning', message: 'The chapter is still opening. Try again in a moment.' });
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const { out } = await pdfCopy('print');
      printPdf(new Blob([out], { type: 'application/pdf' }), () => toast({ kind: 'neutral',
        message: 'The copy with your marks opened in a new tab: print it from there.' }));
    } catch (error) {
      console.warn('print failed', error);
      toast({ kind: 'warning', message: "The book couldn't be printed. Try again." });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, [kind, reader, toast, pdfCopy]);

  return { save, print, busy, canPick };
}

/**
 * Prints a PDF `blob` from a hidden frame once the browser's viewer has it; `onTab()` when that is not possible and it
 * opened in a new tab instead. The frame stays a minute (the print dialog reads from it), then goes.
 */
function printPdf(blob, onTab) {
  const url = URL.createObjectURL(blob);
  const frame = Object.assign(document.createElement('iframe'), { src: url, title: 'Print', tabIndex: -1 });
  frame.setAttribute('data-rf-print', '');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;inset-inline-start:-10000px;width:1px;height:1px;border:0';
  const done = () => setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000);
  frame.addEventListener('load', () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      window.open(url, '_blank', 'noopener');
      onTab();
    }
    done();
  }, { once: true });
  document.body.append(frame);
}
