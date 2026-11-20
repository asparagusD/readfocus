/**
 * Words on a notebook page (C37.3; shared since C37.4), with Excalidraw: notebookItems.js lines as Excalidraw text
 * elements stacked from a point, in its hand face (code in its code face), small lines in its grey. Only loaded
 * with Excalidraw (DrawingEditor, and the typed notes moved when the notebook first opens).
 */
import { convertToExcalidrawElements, FONT_FAMILY } from '@excalidraw/excalidraw';

const FACES = { hand: FONT_FAMILY.Excalifont, code: FONT_FAMILY['Comic Shanns'] ?? FONT_FAMILY.Cascadia };
const FACE_NAMES = { hand: 'Excalifont', code: 'Comic Shanns' };
const MUTED = '#868e96'; // Excalidraw's own grey, which its dark theme inverts with the rest
const GAP = 12; // between the lines of one thing
export const BREAK = 32; // between what a page held and what is added
export const TOP_LEFT = { x: 64, y: 112 }; // on an empty page: below Excalidraw's menu, toolbar and hint

/** The faces the lines use, loaded before Excalidraw measures them (a box measured in a fallback face clips). */
export async function facesFor(lines) {
  const wanted = [...new Set(lines.map((l) => `${l.size}px "${FACE_NAMES[l.font] ?? FACE_NAMES.hand}"`))];
  const loading = Promise.all(wanted.map((font) => document.fonts?.load(font)));
  await Promise.race([loading, new Promise((resolve) => { setTimeout(resolve, 3000); })]).catch(() => {});
}

/** The lines as text elements, the first at (x, y), each below the last; call after facesFor. */
export function textElements(lines, { x, y }) {
  const made = [];
  let at = y;
  for (const piece of lines) {
    if (!piece.text) continue;
    const [text] = convertToExcalidrawElements([{ type: 'text', text: piece.text, x, y: at, fontSize: piece.size,
      fontFamily: FACES[piece.font] ?? FACES.hand, ...(piece.muted ? { strokeColor: MUTED } : {}) }]);
    made.push(text);
    at = text.y + text.height + GAP;
  }
  return made;
}
