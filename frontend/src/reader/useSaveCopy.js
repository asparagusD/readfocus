import { useCallback, useRef, useState } from 'react';
import { fetchApi } from '../lib/api';
import { useToast } from '../components/ui/toastContext';
import { chapterFor, marksMarkdown } from './marksMarkdown';

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
 */
export function useSaveCopy({ bookId, kind, title, reader, annotations, pageCount }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const canPick = typeof globalThis.showSaveFilePicker === 'function';

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
    const probe = paperColours();
    try {
      const marks = [];
      for (let first = 1; first <= Math.max(1, pageCount); first += MARK_PAGES) {
        const data = await fetchApi(`/books/${bookId}/marks?first=${first}&last=${first + MARK_PAGES - 1}`);
        marks.push(...(data?.marks ?? []));
      }
      const bytes = await reader.current?.fileBytes();
      if (!bytes) throw new Error('The book is not open yet.');
      const { EncryptedPdfError, markedCopy } = await import('./saveCopy.js');
      let out;
      try {
        out = await markedCopy(bytes, { annotations: annotations ?? [], marks, colours: probe.colours });
      } catch (error) {
        if (!(error instanceof EncryptedPdfError)) throw error;
        out = bytes;
        toast({ kind: 'warning', message: 'This PDF is locked against changes, so the copy is the book as published, without your marks.' });
      }
      await deliver(new Blob([out], { type: 'application/pdf' }), name, handle);
      if (out !== bytes) toast({ kind: 'success', message: handle ? `Saved ${handle.name ?? name}.` : `Saved a copy with your marks: ${name}` });
    } catch (error) {
      console.warn('save a copy failed', error);
      toast({ kind: 'warning', message: "The copy wasn't saved. Try again." });
    } finally {
      probe.done();
      working.current = false;
      setBusy(false);
    }
  }, [kind, title, canPick, bookId, pageCount, reader, annotations, toast]);

  return { save, busy, canPick };
}
