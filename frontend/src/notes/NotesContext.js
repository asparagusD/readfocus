import { createContext, useContext } from 'react';

/**
 * The notepad's actions for the rest of the reading page (C22.6): `add({ kind, place, content, imageB64, regionId,
 * annotationId, open })` makes a note from the book and shows it, returning its key; `edit(key, change)` changes
 * it later (a LaTeX that arrives after the note); `drag(make)` remembers what a region dragged from the book
 * would add, and `drop()` adds it. Null where there is no notepad (the gallery).
 */
export const NotesContext = createContext(null);

export const useNotesActions = () => useContext(NotesContext);

/** The drag type of a region dragged from the book onto the notepad. */
export const NOTE_DRAG = 'application/x-readfocus-region';
