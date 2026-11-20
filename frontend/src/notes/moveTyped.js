/**
 * C37.4 (issue 25, your decision D1 A): the typed notes a reader already has become notebook pages the first time
 * the book's notebook opens, in the browser and saved like any edit (no backfill, no bulk write from a script).
 * Each note with words becomes a page at its place (its anchors, highlight and region links kept) holding its words
 * as text; its row is soft-deleted only after that page is saved. A note with no words is soft-deleted alone. A
 * page saved whose delete failed is remembered (`moved`), so the next try only deletes: no second page.
 * Pure orchestration: the caller gives `lines(note)`, `elements(lines)`, `create(body)`, `remove(id)` and `moved`.
 */

const MOVED_KEY = 'rf-moved-typed';

/** The notes still to move: typed, saved (not pending) and not deleted. */
export const typedNotes = (notes) => (notes ?? []).filter((n) => n.kind === 'text' && !n.pending && !n.deleted_at);

/** The new page's body: the note's place and links, its words as Excalidraw elements. */
export function pageBody(note, elements) {
  return {
    kind: 'drawing', scope: note.scope, anchors: note.anchors, position_start: note.position_start,
    position_end: note.position_end, content: { elements, appState: { viewBackgroundColor: '#ffffff' } },
    ...(note.annotation_id ? { annotation_id: note.annotation_id } : {}), ...(note.region_id ? { region_id: note.region_id } : {}),
  };
}

/** Moves each typed note in turn; never throws. { moved, failed }: pages made (or found made), notes left. */
export async function moveTyped(notes, { lines, elements, create, remove, moved }) {
  let made = 0;
  let failed = 0;
  for (const note of typedNotes(notes)) {
    try {
      if (!moved.get(note.id)) {
        const words = lines(note);
        if (words.length) {
          const saved = await create(pageBody(note, await elements(words)));
          moved.set(note.id, saved.id);
        }
      }
      await remove(note.id);
      if (moved.get(note.id)) made += 1;
      moved.clear(note.id);
    } catch {
      failed += 1; // the note stays (and its page, if made, is remembered), so the next opening tries again
    }
  }
  return { moved: made, failed };
}

/** Pages already made for notes whose delete did not go through, kept on this device. */
export function movedStore(storage = globalThis.localStorage) {
  const read = () => {
    try { return JSON.parse(storage?.getItem(MOVED_KEY) ?? '{}') ?? {}; } catch { return {}; }
  };
  const write = (all) => {
    try { storage?.setItem(MOVED_KEY, JSON.stringify(all)); } catch { /* private window: the move still works once */ }
  };
  return {
    get: (id) => read()[id] ?? null,
    set: (id, pageId) => write({ ...read(), [id]: pageId }),
    clear: (id) => { const all = read(); delete all[id]; write(all); },
  };
}
