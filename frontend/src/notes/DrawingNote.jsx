import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardPaste } from 'lucide-react';
import { passageOf } from './drawing';
import { serveOwnFonts } from './excalidrawFonts';

// Excalidraw's fonts from our own origin only, set up before its chunk runs (excalidrawFonts.js): the bundler
// runs Excalidraw's chunk before any code of DrawingEditor's own (DEBUG_LOG 2026-11-14 C22.3).
const DrawingEditor = lazy(() => {
  serveOwnFonts();
  return import('./DrawingEditor');
});
const NARROW = '(max-width: 759px)';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW);
    if (!query) return undefined;
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** A drawing in the list (C22.3): its PNG thumbnail (Lamplight inverts it like Excalidraw's dark mode), or a line. */
export function DrawingThumb({ note, reference, onOpen }) {
  const url = note.urls?.[note.thumbnail_path];
  const drawn = (note.content?.elements ?? []).length > 0;
  return (
    <div className="rf-note-read rf-note-drawing" role="button" tabIndex={0} aria-label={`Edit drawing at ${reference}`}
      onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}>
      {url ? (
        <img className="rf-note-thumb" src={url} alt={`Drawing at ${reference}`} width={480} height={270} loading="lazy" decoding="async" />
      ) : (
        <p className="rf-note-empty">{drawn ? 'A drawing (its picture appears after Done)' : 'Empty drawing'}</p>
      )}
    </div>
  );
}

/**
 * An open drawing (C22.3): Excalidraw, loaded now, inside the note on a wide screen, or full screen on a phone
 * with the passage reference at the top. "Paste passage" adds the note's text; Done makes the thumbnail and
 * hands it to `onDone(blob | null)`. Escape inside the drawing stays with Excalidraw (data-own-escape).
 */
export function DrawingFrame({ note, reference, onChange, onDone }) {
  const narrow = useNarrow();
  const tools = useRef(null);
  const [busy, setBusy] = useState(false);
  const passage = passageOf(note);
  const dark = document.documentElement.dataset.theme === 'lamplight';
  const finish = async () => {
    setBusy(true);
    const blob = await (tools.current?.finish() ?? Promise.resolve(null)).catch(() => null);
    onDone(blob);
  };
  const frame = (
    <div className="rf-drawing" data-own-escape="true">
      <div className="rf-drawing-bar">
        {narrow && <p className="rf-drawing-ref">{reference}</p>}
        <button type="button" className="rf-drawing-paste" disabled={!passage} onClick={() => tools.current?.paste()}
          title={passage ? 'Add the passage as text in the drawing' : 'This note is about whole pages, with no passage selected'}>
          <ClipboardPaste size={15} strokeWidth={1.75} aria-hidden="true" />Paste passage
        </button>
        <button type="button" className="rf-note-done" onClick={finish} disabled={busy}>{busy ? 'Saving…' : 'Done'}</button>
      </div>
      <Suspense fallback={<p className="rf-note-small rf-drawing-wait" role="status">Opening the drawing…</p>}>
        <DrawingEditor content={note.content} dark={dark} passage={passage} onChange={onChange}
          register={(made) => { tools.current = made; }} />
      </Suspense>
    </div>
  );
  if (!narrow) return frame;
  return createPortal(
    <div className="rf-drawing-screen" role="dialog" aria-modal="true" aria-label={`Drawing at ${reference}`}
      data-theme={dark ? 'lamplight' : undefined}>
      {frame}
    </div>,
    document.body,
  );
}
