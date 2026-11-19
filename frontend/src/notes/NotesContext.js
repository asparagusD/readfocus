import { createContext, useContext } from 'react';

/**
 * The notes' actions for the rest of the reading page (C22.6): `add({ kind, place, content, imageB64, regionId,
 * annotationId, open })` makes a note from the book and shows it, returning { key, content }: since C37.3 code and
 * an equation with its LaTeX go onto a notebook page, a figure or an equation with no LaTeX stays a block note;
 * `edit(key, change)` changes a note later. Null where there is no notepad (the gallery). The drag onto the notepad
 * is retired (C37.3): the book is inert while the notebook is open, so nothing could be dropped on it.
 */
export const NotesContext = createContext(null);

export const useNotesActions = () => useContext(NotesContext);

