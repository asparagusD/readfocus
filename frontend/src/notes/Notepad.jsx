import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, Code2, Image, Link2, PenLine, Plus, Sigma, Trash2, Type } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { NoteDoc } from './NoteDoc';
import { DrawingFrame, DrawingThumb } from './DrawingNote';
import { BlockNote } from './BlockNote';
import { NOTE_DRAG, useNotesActions } from './NotesContext';
import { reference } from './place';
import { overallStatus } from './status';
import { followAction, notesFor, overlapping } from './sync';
import { prefersReducedMotion } from '../motion/presets';
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
 * C22.5: `range` is the A4 range the book shows (sync.js). The notes on it are marked; when it changes the list
 * scrolls to the first of them, or, while a note is open or just after the reader scrolled the list, offers "Jump
 * to notes for this page"; a move the notepad asked for (a reference) does not scroll it. A filter shows this
 * page, this chapter (`contents()`, the book's entries) or all.
 */
const FILTERS = [{ id: 'page', label: 'This page' }, { id: 'chapter', label: 'This chapter' }, { id: 'all', label: 'All' }];
const EMPTY = { page: 'No notes on these pages yet', chapter: 'No notes in this chapter yet' };

/** "This page | This chapter | All" as one radio group: one tab stop, arrows, Home and End pick. */
function NotesFilter({ value, onChange }) {
  const onKeyDown = (event) => {
    const i = FILTERS.findIndex((f) => f.id === value);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: FILTERS.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = FILTERS[(to + FILTERS.length) % FILTERS.length];
    onChange(next.id);
    event.currentTarget.querySelector(`[data-filter="${next.id}"]`)?.focus();
  };
  return (
    <div className="rf-notes-filter" role="radiogroup" aria-label="Show notes" onKeyDown={onKeyDown}>
      {FILTERS.map((f) => (
        <button key={f.id} type="button" role="radio" data-filter={f.id} aria-checked={value === f.id}
          tabIndex={value === f.id ? 0 : -1} onClick={() => onChange(f.id)}>{f.label}</button>
      ))}
    </div>
  );
}
export function Notepad({ notes, state, statuses, describe, onGoTo, onRemove, onReload, onRetry, onKeepMine, onTakeTheirs, onChange, onAdd, onThumbnail, onDrawing, onRelink, request = null, range = null, contents = () => [] }) {
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
      const first = document.querySelector(`.rf-note[data-id="${focused.ids[0]}"], .rf-note[data-key="${focused.ids[0]}"]`);
      first?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      (first?.querySelector('.rf-note-read') ?? first?.querySelector('.rf-note-ref'))?.focus();
    }));
    const clear = setTimeout(() => setFocused(null), 4000);
    return () => { cancelAnimationFrame(frame); clearTimeout(clear); };
  }, [focused]);
  // C22.5: following the book.
  const [filter, setFilter] = useState('all');
  const [pill, setPill] = useState(null); // the range key the jump pill is offered for
  const root = useRef(null);
  const jumpAt = useRef(-Infinity);
  const handAt = useRef(-Infinity);
  const first = useRef(true); // opening the notepad goes straight to the page's notes
  const shown = notesFor(notes, filter, range, filter === 'chapter' ? contents() : []);
  const hereIds = new Set(overlapping(notes, range).map((n) => n.id));
  const rangeKey = range ? `${range.start}-${range.end}` : '';
  const target = shown.find((n) => hereIds.has(n.id))?.id ?? null;
  const scrollTo = useCallback((id, smooth) => {
    const list = root.current;
    const card = id && list?.querySelector(`.rf-note[data-id="${id}"]`);
    if (!card) return;
    const box = list.getBoundingClientRect();
    const at = card.getBoundingClientRect();
    if (at.top >= box.top && at.bottom <= box.bottom) return; // already in view: the header and filter stay
    const top = at.top - box.top + list.scrollTop - 8;
    list.scrollTo({ top: Math.max(0, top), behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
  }, []);
  const latest = useRef({});
  const busy = Boolean(focused) || Boolean(request && seen !== request.n);
  useEffect(() => { latest.current = { target, typing: editing !== null, busy }; });
  useEffect(() => {
    if (state !== 'ready' || !rangeKey) return undefined;
    const frame = requestAnimationFrame(() => {
      const { target: id, typing, busy } = latest.current;
      if (busy) return;
      const opening = first.current;
      first.current = false;
      const action = opening ? (id ? 'scroll' : 'none')
        : followAction({ hasTarget: Boolean(id), typing, now: Date.now(), jumpAt: jumpAt.current, handAt: handAt.current });
      if (action === 'scroll') { setPill(null); scrollTo(id, !opening); }
      else setPill(action === 'pill' ? rangeKey : null);
    });
    return () => cancelAnimationFrame(frame);
  }, [rangeKey, state, scrollTo]);
  // C22.6: an equation or listing dragged from the book is added where it is dropped.
  const notesActions = useNotesActions();
  const [dropping, setDropping] = useState(false);
  const canDrop = (event) => Boolean(notesActions) && [...(event.dataTransfer?.types ?? [])].includes(NOTE_DRAG);
  const onDragOver = (event) => {
    if (!canDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (event) => {
    if (!canDrop(event)) return;
    event.preventDefault();
    setDropping(false);
    notesActions.drop();
  };
  const byHand = useCallback(() => { handAt.current = Date.now(); }, []);
  const goTo = useCallback((note) => { jumpAt.current = Date.now(); setPill(null); onGoTo(note); }, [onGoTo]);
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
    <div className="rf-notes" ref={root} onWheel={byHand} onTouchMove={byHand} data-drop={dropping || undefined}
      onDragOver={onDragOver} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropping(false); }} onDrop={onDrop}
      onKeyDown={(event) => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown'].includes(event.key) && !event.target.closest('[contenteditable="true"]')) byHand(); }}>
      <div className="rf-notes-head">
        <p className="rf-notes-count">{shown.length === 1 ? '1 note' : `${shown.length} notes`}</p>
        <p className="rf-notes-order">In book order</p>
      </div>
      {state === 'ready' && notes.length > 0 && <NotesFilter value={filter} onChange={setFilter} />}
      {pill && pill === rangeKey && target && (
        <button type="button" className="rf-notes-jump" onClick={() => { setPill(null); scrollTo(target, true); }}>
          Jump to notes for this page
        </button>
      )}
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
      {state === 'ready' && notes.length > 0 && !shown.length && (
        <p className="rf-note-small rf-notes-none">{EMPTY[filter]}. <button type="button" className="rf-notes-all" onClick={() => setFilter('all')}>Show all notes</button></p>
      )}
      {shown.length > 0 && (
        <ol className="rf-notes-list">
          {shown.map((note) => {
            const { label, Icon } = KINDS[note.kind] ?? KINDS.text;
            const where = describe(note);
            const ref = reference(where.page, where.chapter);
            const key = note.key ?? note.id;
            const open = editing === key && (note.kind === 'text' || note.kind === 'drawing');
            return (
              <li key={key} className="rf-note" data-kind={note.kind} data-id={note.id} data-key={key}
                data-new={note.key ? 'true' : undefined} data-editing={open || undefined}
                data-focused={focused?.ids.some((x) => x === note.id || x === note.key) || undefined} data-here={hereIds.has(note.id) || undefined}>
                <div className="rf-note-head">
                  <button type="button" className="rf-note-ref" onClick={() => goTo(note)} aria-label={`Go to ${ref}`}>
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
                  {['equation', 'code', 'figure'].includes(note.kind) && (
                    <BlockNote note={note} reference={ref} onChange={(change) => onChange(note.id, change)} />
                  )}
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
