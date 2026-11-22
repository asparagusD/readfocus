import { createContext, useContext } from 'react';

/**
 * The notes' actions for the rest of the reading page (C22.6): `add({ kind, place, content, imageB64, regionId })`
 * puts a block from the book on a notebook page and shows it, returning { key, content }: code and an equation
 * with its LaTeX as text (C37.3), a figure or an equation with no LaTeX as its picture and caption (C37.6);
 * `edit(key, change)` changes a note later. Null where there is no notepad (the gallery). The drag onto the notepad
 * is retired (C37.3): the book is inert while the notebook is open, so nothing could be dropped on it.
 */
export const NotesContext = createContext(null);

export const useNotesActions = () => useContext(NotesContext);

