import { lazy, Suspense, useEffect, useState } from 'react';
import { Bookmark, Code2, Image, Link2, PenLine, Plus, Sigma, Trash2, Type } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { NoteDoc } from './NoteDoc';
import { DrawingFrame, DrawingThumb } from './DrawingNote';
import { reference } from './place';
import { overallStatus } from './status';
import './Notepad.css';

const KINDS = {
  text: { label: 'Text', Icon: Type },
  drawing: { label: 'Drawing', Icon: PenLine },
  equation: { label: 'Equation', Icon: Sigma },
  code: { label: 'Code', Icon: Code2 },
  figure: { label: 'Figure', Icon: Image },
};

function NoteState({ status, onRetry, onKeepMine, onTakeTheirs }) {
  if (status === 'conflict') {
    return (
      <div className="rf-note-alert" role="alert">
        <p>This note changed in another tab.</p>
        <div className="rf-note-actions">
          <Button variant="secondary" onClick={onTakeTheirs}>Use the saved one</Button>
          <Button variant="ghost" onClick={onKeepMine}>Keep mine</Button>
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="rf-note-alert" role="alert">
        <p>This change could not be saved.</p>
        <div className="rf-note-actions"><Button variant="secondary" onClick={onRetry}>Try again</Button></div>
      </div>
    );
  }
  if (status === 'offline') return <p className="rf-note-small">Waiting to save</p>;
  return null;
}

const TextEditor = lazy(() => import('./TextEditor'));

/**
 * The notepad (C22.2, handoff screen 19): the reader's note blocks in book order, each under a reference to its
 * passage ("p. 45 · Fourier series", a button that goes there) and its kind. Text notes are drawn by NoteDoc and
 * edited in TipTap, loaded the first time one is opened (C22.2b): a click, or Enter on a focused note, opens it;
 * Escape or Done closes it. "Text" adds a note at the selection or the pages shown and opens it. C22.3: drawings
 * show their thumbnail and open in Excalidraw (DrawingNote.jsx); "Drawing" adds one. Loading, error and empty
 * states; one save line, announced politely; a conflict or a refused save on its note. C22.4: `request` from the
 * book ({ type: 'edit', key } for a new note by N or the selection toolbar, { type: 'focus', ids } from a margin
 * marker) opens or focuses notes; each note's link button moves its anchor to the selection (`onRelink`).
 */
export function Notepad({ notes, state, statuses, describe, onGoTo, onRemove, onReload, onRetry, onKeepMine, onTakeTheirs, onChange, onAdd, onThumbnail, onDrawing, onRelink, request = null }) {
  const [editing, setEditing] = useState(null); // a note's key (or id)
  const [focused, setFocused] = useState(null); // { ids } opened from a margin marker
  const [seen, setSeen] = useState(null); // the last request taken, so each is taken once, when the list is ready
  if (request && state === 'ready' && seen !== request.n) {
    setSeen(request.n);
    setEditing(request.type === 'edit' ? request.key : null);
    setFocused(request.type === 'focus' ? { ids: request.ids, n: request.n } : null);
  }
  useEffect(() => {
    if (!focused) return undefined;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => { // after the panel has focused its tab
      const first = document.querySelector(`.rf-note[data-id="${focused.ids[0]}"]`);
      first?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      (first?.querySelector('.rf-note-read') ?? first?.querySelector('.rf-note-ref'))?.focus();
    }));
    const clear = setTimeout(() => setFocused(null), 4000);
    return () => { cancelAnimationFrame(frame); clearTimeout(clear); };
  }, [focused]);
  const drawingOpen = notes.some((n) => (n.key ?? n.id) === editing && n.kind === 'drawing');
  useEffect(() => { onDrawing?.(drawingOpen); }, [drawingOpen, onDrawing]); // the side panel widens for it
  useEffect(() => () => onDrawing?.(false), [onDrawing]);
  const status = overallStatus(statuses, notes.filter((n) => !n.pending).map((n) => n.id));
  const add = async (kind) => {
    const key = await onAdd(kind);
    if (key) setEditing(key);
  };
  const stop = (note) => {
    setEditing(null);
    if (!note.pending) onRetry(note.id); // save now rather than in 800 ms
    requestAnimationFrame(() => document.querySelector(`.rf-note[data-key="${note.key ?? note.id}"] .rf-note-read`)?.focus());
  };
  return (
    <div className="rf-notes">
      <div className="rf-notes-head">
        <p className="rf-notes-count">{notes.length === 1 ? '1 note' : `${notes.length} notes`}</p>
        <p className="rf-notes-order">In book order</p>
      </div>
      <p className="rf-notes-status" role="status" aria-live="polite">{state === 'ready' ? status : ''}</p>
      {state === 'loading' && <p className="rf-note-small" role="status">Opening your notes…</p>}
      {state === 'error' && (
        <div className="rf-note-alert" role="alert">
          <p>Your notes could not be loaded.</p>
          <div className="rf-note-actions"><Button variant="secondary" onClick={onReload}>Try again</Button></div>
        </div>
      )}
      {state === 'ready' && !notes.length && (
        <div className="rf-notes-empty">
          <p className="rf-notes-empty-title">No notes in this book yet</p>
          <p className="rf-note-small">A note sits beside the passage it is about: select a sentence first, or write about the pages you are on.</p>
        </div>
      )}
      {notes.length > 0 && (
        <ol className="rf-notes-list">
          {notes.map((note) => {
            const { label, Icon } = KINDS[note.kind] ?? KINDS.text;
            const where = describe(note);
            const ref = reference(where.page, where.chapter);
            const key = note.key ?? note.id;
            const open = editing === key && (note.kind === 'text' || note.kind === 'drawing');
            return (
              <li key={key} className="rf-note" data-kind={note.kind} data-id={note.id} data-key={key}
                data-new={note.key ? 'true' : undefined} data-editing={open || undefined}
                data-focused={focused?.ids.includes(note.id) || undefined}>
                <div className="rf-note-head">
                  <button type="button" className="rf-note-ref" onClick={() => onGoTo(note)} aria-label={`Go to ${ref}`}>
                    <Bookmark size={14} strokeWidth={1.75} aria-hidden="true" />
                    <span>{ref}</span>
                  </button>
                  {open && note.kind === 'text' && <button type="button" className="rf-note-done" onClick={() => stop(note)}>Done</button>}
                  <span className="rf-note-kind" title={label}>
                    <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span className="rf-note-hidden">{label} note</span>
                  </span>
                  {onRelink && (
                    // C22.4: a press here keeps the book's selection, which the note moves to.
                    <button type="button" className="rf-note-link" onPointerDown={(event) => event.preventDefault()}
                      onMouseDown={(event) => event.preventDefault()} onClick={() => onRelink(note)}
                      aria-label={`Link note at ${ref} to the current selection`} title="Link to current selection">
                      <Link2 size={15} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  )}
                  <button type="button" className="rf-note-delete" onClick={() => onRemove(note.id)} disabled={note.pending}
                    aria-label={`Delete note at ${ref}`}>
                    <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
                <div className="rf-note-body">
                  {open && note.kind === 'drawing' && (
                    <DrawingFrame note={note} reference={ref} onChange={(content) => onChange(note.id, { content })}
                      onDone={(blob) => { onThumbnail(note, blob); stop(note); }} />
                  )}
                  {!open && note.kind === 'drawing' && <DrawingThumb note={note} reference={ref} onOpen={() => setEditing(key)} />}
                  {open && note.kind === 'text' && (
                    <Suspense fallback={<NoteDoc doc={note.content} />}>
                      <TextEditor content={note.content} label={`Note at ${ref}`}
                        onChange={(content) => onChange(note.id, { content })} onDone={() => stop(note)} />
                    </Suspense>
                  )}
                  {!open && note.kind === 'text' && (
                    <div className="rf-note-read" role="button" tabIndex={0} aria-label={`Edit note at ${ref}`}
                      onClick={() => setEditing(key)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditing(key); } }}>
                      <NoteDoc doc={note.content} />
                    </div>
                  )}
                  {!['text', 'drawing'].includes(note.kind) && <p className="rf-note-small">{label} notes open in a later version.</p>}
                </div>
                <NoteState status={statuses[note.id]?.status} onRetry={() => onRetry(note.id)}
                  onKeepMine={() => onKeepMine(note.id)} onTakeTheirs={() => onTakeTheirs(note.id)} />
              </li>
            );
          })}
        </ol>
      )}
      {state === 'ready' && (
        <div className="rf-notes-add">
          <button type="button" className="rf-notes-pill" onClick={() => add('text')}>
            <Plus size={15} strokeWidth={1.75} aria-hidden="true" />Text
          </button>
          <button type="button" className="rf-notes-pill" onClick={() => add('drawing')}>
            <Plus size={15} strokeWidth={1.75} aria-hidden="true" />Drawing
          </button>
          <p className="rf-note-small">At your selection, or the pages you are on</p>
        </div>
      )}
    </div>
  );
}
