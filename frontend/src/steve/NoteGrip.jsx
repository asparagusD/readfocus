import { GripVertical } from 'lucide-react';
import { NOTE_DRAG, useNotesActions } from '../notes/NotesContext';

/**
 * C22.6: a grip in an equation's or a listing's action bar, dragged onto the notepad on a desktop to add the block
 * there (a click adds it too, so it works from the keyboard). `onAdd` makes the note; `onDragging` keeps the bar
 * up while the drag lasts.
 */
export function NoteGrip({ onAdd, onDragging }) {
  const notes = useNotesActions();
  if (!notes) return null;
  return (
    <button type="button" className="rf-block-act rf-block-grip" draggable="true" tabIndex={-1}
      aria-label="Drag to notes" title="Drag to notes (or click to add)" onClick={onAdd}
      onDragStart={(event) => {
        event.dataTransfer.setData(NOTE_DRAG, '1');
        event.dataTransfer.effectAllowed = 'copy';
        notes.drag(onAdd);
        onDragging?.(true);
      }}
      onDragEnd={() => onDragging?.(false)}>
      <GripVertical size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
