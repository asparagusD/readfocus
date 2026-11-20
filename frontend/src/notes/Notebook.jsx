import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardPaste, LocateFixed, NotebookPen, Plus, Trash2, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { NoteState } from './Notepad';
import { passageOf } from './drawing';
import { serveOwnFonts } from './excalidrawFonts';
import { reference } from './place';
import { openingPage, pageHere, pageKey, pageStatus } from './notebookPages';
import './Notebook.css';

// Excalidraw's fonts from our own origin, set up before its chunk runs (DEBUG_LOG 2026-11-14 C22.3).
const DrawingEditor = lazy(() => {
  serveOwnFonts();
  return import('./DrawingEditor');
});

/** "Page 1 | Page 2 | …" as one tablist: one tab stop, arrows, Home and End turn to a page. */
function PageTabs({ pages, current, onPick }) {
  const onKeyDown = (event) => {
    const i = pages.findIndex((p) => pageKey(p) === current);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: pages.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const list = event.currentTarget;
    const next = pages[Math.max(0, Math.min(pages.length - 1, to))];
    onPick(pageKey(next));
    requestAnimationFrame(() => list.querySelector('[aria-selected="true"]')?.focus());
  };
  return (
    <div className="rf-notebook-tabs" role="tablist" aria-label="Pages" onKeyDown={onKeyDown}>
      {pages.map((p, i) => {
        const on = pageKey(p) === current;
        return (
          <button key={pageKey(p)} type="button" role="tab" aria-selected={on} aria-controls="rf-notebook-page"
            tabIndex={on ? 0 : -1} className="rf-notebook-tab" onClick={() => onPick(pageKey(p))}
            aria-label={`Page ${i + 1}`}>{i + 1}</button>
        );
      })}
    </div>
  );
}

/**
 * The notebook (C37.2, issue 26): one per book, its pages the book's drawing notes in book order, open over 70 % of
 * the screen on the right while the book stays in soft focus in the other 30 % (ReadingSession blurs and inerts
 * it). A click on the blurred book, the close button, or Escape (once Excalidraw has nothing left to do with it)
 * tucks the notebook away; it reopens on the page it was left on. Pages turn by the arrows or the page tabs;
 * "Go to this place" turns to the page made at the place the book shows; "New page" starts one there. A page saves as
 * it changes; leaving it (a turn or closing) makes its thumbnail when it changed. Full screen below 760 px.
 * C37.3: `incoming` ({ key, lines, n }) is something from the book for the page `key`: the notebook turns there and
 * the editor adds the lines (notebookItems.js), once, then `onIncoming(n)`. "All notes" opens the notepad's list.
 * C37.4: `moving` says typed notes are becoming pages; a page asked for that is gone shows the opening page.
 */
export function Notebook({ title, pages, state, statuses, range, describe, current, onPage, onNew, onChange, onThumbnail,
  onRemove, onGoTo, onRetry, onKeepMine, onTakeTheirs, onReload, onClose, returnTo, beside = false, total = 0, onAll,
  incoming = null, onIncoming, moving = false }) {
  const tools = useRef(null);
  const dirty = useRef(null); // the key of the page changed since it was opened
  const layer = useRef(null);
  const [epoch, setEpoch] = useState(0); // a page taken back from the server opens afresh
  const [busy, setBusy] = useState(false);
  const [grab, setGrab] = useState(true);
  const [toolsFor, setToolsFor] = useState(null); // the editor whose tools are in hand
  const delivered = useRef(null); // the page opened with the notebook, or a new one, takes the focus; a turned page does not
  // The page asked for, else (gone, or none yet when pages arrive) the one the notebook would open at.
  const byId = pages.find((p) => p.id === current);
  const shown = openingPage(pages, range, byId ? pageKey(byId) : current);
  const index = pages.findIndex((p) => pageKey(p) === shown);
  const page = index >= 0 ? pages[index] : null;
  const here = pageHere(pages, range);
  const where = page ? describe(page) : null;
  const ref = where ? reference(where.page, where.chapter) : '';
  const passage = page ? passageOf(page) : '';
  const editorKey = page ? `${pageKey(page)}:${epoch}` : null;
  const register = useCallback((made) => { tools.current = made; setToolsFor(editorKey); }, [editorKey]);

  /** Leaving the open page: its thumbnail when it changed, and its last change sent now. */
  const leave = useCallback(() => {
    if (!page || dirty.current !== pageKey(page)) return;
    dirty.current = null;
    const made = tools.current?.finish();
    if (!page.pending) onRetry(page.id);
    made?.then((blob) => onThumbnail(page, blob)).catch(() => {});
  }, [page, onRetry, onThumbnail]);
  const turn = (key, focus = false) => {
    if (!key || key === pageKey(page ?? {})) return;
    setGrab(focus);
    leave();
    onPage(key);
  };
  const close = useCallback(() => { leave(); onClose(); }, [leave, onClose]);

  useEffect(() => {
    layer.current?.querySelector('.rf-notebook')?.focus({ preventScroll: true });
    const back = returnTo;
    return () => back?.current?.focus?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once: focus on open, give it back on close

  useEffect(() => {
    // Capture runs before Excalidraw's own handlers, so its state still says whether Escape is its to use.
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const at = document.activeElement;
      if (at && at !== document.body && !layer.current?.contains(at)) return; // Steve's panel, say
      if (layer.current?.querySelector('.rf-drawing-canvas')?.contains(event.target) && tools.current?.idle?.() === false) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  useEffect(() => { // C37.3: something from the book, once its page is open and its editor ready
    if (!incoming || delivered.current === incoming.n || !page || toolsFor !== editorKey) return;
    if (pageKey(page) !== incoming.key && page.id !== incoming.key) return;
    delivered.current = incoming.n;
    tools.current?.add(incoming.lines).then(() => { dirty.current = pageKey(page); }).catch(() => {});
    onIncoming?.(incoming.n);
  }, [incoming, page, toolsFor, editorKey, onIncoming]);

  const add = async () => {
    setBusy(true);
    const key = await onNew();
    setBusy(false);
    if (key) turn(key, true);
  };
  const remove = () => {
    if (!page || page.pending) return;
    const next = pages[index + 1] ?? pages[index - 1] ?? null;
    dirty.current = null;
    onRemove(page.id);
    onPage(next ? pageKey(next) : null);
  };
  const takeTheirs = async () => {
    await onTakeTheirs(page.id);
    setEpoch((n) => n + 1);
  };
  const status = page && !page.pending ? statuses[page.id]?.status : null;

  return (
    <div className="rf-notebook-layer" ref={layer} data-beside={beside || undefined}>
      <div className="rf-notebook-scrim" aria-hidden="true" onClick={close} />
      <section id="rf-notebook" className="rf-notebook" role="dialog" aria-modal={!beside} aria-labelledby="rf-notebook-title" tabIndex={-1}>
        <header className="rf-notebook-head">
          <div className="rf-notebook-name">
            <h2 id="rf-notebook-title" className="rf-notebook-title">Notebook</h2>
            <p className="rf-notebook-book">{title}</p>
          </div>
          {page && (
            <button type="button" className="rf-notebook-ref" onClick={() => { close(); onGoTo(page); }}
              aria-label={`Go to ${ref} in the book`} title="Go to this page's place in the book">
              <span>{ref}</span>
            </button>
          )}
          <div className="rf-notebook-actions">
            {page && (
              <button type="button" className="rf-notebook-tool" disabled={!passage} onClick={() => tools.current?.paste()}
                title={passage ? 'Add the passage as text on the page' : 'This page is about whole pages, with no passage selected'}>
                <ClipboardPaste size={16} strokeWidth={1.75} aria-hidden="true" /><span>Paste passage</span>
              </button>
            )}
            {pages.length > 0 && (
              <button type="button" className="rf-notebook-tool" disabled={!here || here === pageKey(page ?? {})}
                onClick={() => turn(here)} aria-label="Go to the page made at this place in the book"
                title={here ? 'The page made at the place the book shows' : 'No page was made at this place yet'}>
                <LocateFixed size={16} strokeWidth={1.75} aria-hidden="true" /><span>Go to this place</span>
              </button>
            )}
            {state === 'ready' && (
              <button type="button" className="rf-notebook-tool" onClick={add} disabled={busy} title="A new page at the place the book shows">
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" /><span>New page</span>
              </button>
            )}
            {page && (
              <button type="button" className="rf-notebook-icon" onClick={remove} disabled={page.pending} aria-label={`Delete page ${index + 1}`}>
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
            <button type="button" className="rf-notebook-icon" onClick={close} aria-label="Close notebook">
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div id="rf-notebook-page" className="rf-notebook-page" role={pages.length ? 'tabpanel' : undefined}
          aria-label={page ? `Page ${index + 1} of ${pages.length}` : undefined}>
          {state === 'loading' && <p className="rf-notebook-note" role="status">Opening your notebook…</p>}
          {state === 'error' && (
            <div className="rf-notebook-empty" role="alert">
              <p className="rf-notebook-empty-title">Your notebook could not be opened.</p>
              <Button variant="secondary" onClick={onReload}>Try again</Button>
            </div>
          )}
          {state === 'ready' && !page && (
            <div className="rf-notebook-empty">
              <NotebookPen size={28} strokeWidth={1.5} aria-hidden="true" />
              <p className="rf-notebook-empty-title">No pages yet</p>
              <p className="rf-notebook-note">A page remembers the place in the book where you started it. Start one at the pages you are on.</p>
              <Button onClick={add} disabled={busy}>New page</Button>
            </div>
          )}
          {state === 'ready' && page && (
            <Suspense fallback={<p className="rf-notebook-note" role="status">Opening the page…</p>}>
              <DrawingEditor key={`${pageKey(page)}:${epoch}`} content={page.content} passage={passage}
                dark={document.documentElement.dataset.theme === 'lamplight'}
                focus={grab} onChange={(content) => { dirty.current = pageKey(page); onChange(page.id, { content }); }}
                register={register} />
            </Suspense>
          )}
        </div>

        <footer className="rf-notebook-foot">
          {pages.length > 0 && (
            <div className="rf-notebook-turn">
              <button type="button" className="rf-notebook-icon" onClick={() => turn(pageKey(pages[index - 1] ?? {}))}
                disabled={index <= 0} aria-label="Previous page">
                <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <PageTabs pages={pages} current={page ? pageKey(page) : null} onPick={turn} />
              <button type="button" className="rf-notebook-icon" onClick={() => turn(pageKey(pages[index + 1] ?? {}))}
                disabled={index < 0 || index >= pages.length - 1} aria-label="Next page">
                <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          )}
          <p className="rf-notebook-status" role="status" aria-live="polite">
            {moving ? 'Moving your typed notes into the notebook…' : page ? pageStatus(status, page.pending) : ''}
          </p>
          {onAll && (
            <button type="button" className="rf-notebook-others" onClick={() => { close(); onAll(); }}
              aria-label={`All notes, ${total}`}>
              All notes
            </button>
          )}
        </footer>
        {page && (
          <NoteState status={status} onRetry={() => onRetry(page.id)} onKeepMine={() => onKeepMine(page.id)} onTakeTheirs={takeTheirs} />
        )}
      </section>
    </div>
  );
}
