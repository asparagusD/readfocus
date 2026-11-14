import { Bookmark, Code2, Image, PenLine, Sigma, Trash2, Type } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { NoteDoc } from './NoteDoc';
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

/**
 * The notepad (C22.2, handoff screen 19): the reader's note blocks in book order, each under a reference to its
 * passage ("p. 45 · Fourier series", a button that goes there) and its kind. Text notes are drawn by NoteDoc;
 * `renderBody(note)` may replace a body (the editor, C22.2b). Loading, error and empty states; one save line
 * for the panel, announced politely; a conflict or a refused save is shown on its note with what to do.
 */
export function Notepad({ notes, state, statuses, describe, onGoTo, onRemove, onReload, onRetry, onKeepMine, onTakeTheirs, renderBody, addBar }) {
  const status = overallStatus(statuses, notes.filter((n) => !n.pending).map((n) => n.id));
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
            return (
              <li key={note.id} className="rf-note" data-kind={note.kind} data-id={note.id} data-pending={note.pending || undefined}>
                <div className="rf-note-head">
                  <button type="button" className="rf-note-ref" onClick={() => onGoTo(note)} aria-label={`Go to ${ref}`}>
                    <Bookmark size={14} strokeWidth={1.75} aria-hidden="true" />
                    <span>{ref}</span>
                  </button>
                  <span className="rf-note-kind" title={label}>
                    <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span className="rf-note-hidden">{label} note</span>
                  </span>
                  <button type="button" className="rf-note-delete" onClick={() => onRemove(note.id)} disabled={note.pending}
                    aria-label={`Delete note at ${ref}`}>
                    <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
                <div className="rf-note-body">
                  {renderBody?.(note) ?? (note.kind === 'text' ? <NoteDoc doc={note.content} /> : <p className="rf-note-small">{label} notes open in a later version.</p>)}
                </div>
                <NoteState status={statuses[note.id]?.status} onRetry={() => onRetry(note.id)}
                  onKeepMine={() => onKeepMine(note.id)} onTakeTheirs={() => onTakeTheirs(note.id)} />
              </li>
            );
          })}
        </ol>
      )}
      {addBar}
    </div>
  );
}
