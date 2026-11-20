import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/ui/toastContext';
import { createAutosave } from './autosave';
import { notesApi } from './notesApi';
import { createQueue, idbStore } from './queue';
import { inBookOrder } from './place';
import { base64Of } from './drawing';

const queue = createQueue(idbStore());

/**
 * The reader's note blocks in one book (C22.2; API from C22.1), in book order. `edit(id, change)` shows the change
 * at once and autosaves it 800 ms after the last edit; changes that cannot reach the server wait in IndexedDB and
 * go again on reconnect, on the next visit, and before the tab hides. `statuses` holds each note's save state;
 * `keepMine` / `takeTheirs` settle a conflict with another tab. `create` is optimistic; `remove` offers Undo.
 */
export function useNotes(bookId) {
  const [notes, setNotes] = useState([]);
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [statuses, setStatuses] = useState({});
  const [attempt, setAttempt] = useState(0);
  const { toast } = useToast();
  const made = useRef(0);
  const drafts = useRef(new Map()); // edits to notes the server has not given an id yet
  const ids = useRef(new Map()); // key -> the id the server gave, set the moment it answers
  const autosave = useMemo(() => createAutosave({
    save: notesApi.save, queue,
    onChange: (id, status) => setStatuses((now) => ({ ...now, [id]: status })),
  }), []);

  useEffect(() => {
    if (!bookId) return undefined;
    let live = true;
    notesApi.list(bookId).then((rows) => {
      if (!live) return;
      for (const row of rows) autosave.track(row.id, row.version);
      setNotes((now) => inBookOrder([...rows, ...now.filter((n) => n.pending)]));
      setState('ready');
      autosave.retry();
    }).catch(() => { if (live) setState('error'); });
    return () => { live = false; };
  }, [bookId, autosave, attempt]);

  useEffect(() => { // back online, or the tab is hidden or closing: send what waits
    const online = () => autosave.retry();
    const hide = () => { if (document.visibilityState === 'hidden') autosave.flushAll(); };
    const leave = () => autosave.flushAll();
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
    };
  }, [autosave]);

  const reload = useCallback(() => { setState('loading'); setAttempt((n) => n + 1); }, []);

  /** Shows the note at once and returns its `key` (kept after the server gives it an id, so an open editor
   * stays open); edits made before the server answers are sent as soon as it has. `local` is shown with the note
   * but never sent (C22.6: the signed `urls` of an image just uploaded). */
  const create = useCallback((body, local = {}) => {
    const key = `pending-${(made.current += 1)}`;
    setNotes((list) => inBookOrder([...list, { ...body, ...local, id: key, key, pending: true, version: 0, created_at: new Date().toISOString() }]));
    notesApi.create(bookId, body).then((saved) => {
      ids.current.set(key, saved.id);
      autosave.track(saved.id, saved.version);
      setNotes((list) => list.map((n) => (n.key === key ? { ...saved, ...local, key, content: n.content } : n)));
      const draft = drafts.current.get(key);
      drafts.current.delete(key);
      if (draft) autosave.edit(saved.id, draft);
    }).catch(() => {
      drafts.current.delete(key);
      setNotes((list) => list.filter((n) => n.key !== key));
      toast({ kind: 'warning', message: "That note wasn't added. Try again." });
    });
    return key;
  }, [bookId, autosave, toast]);

  /** A change to a note by its id, or by the key `create` gave (C22.6: a LaTeX that arrives after the note). */
  const edit = useCallback((idOrKey, change) => {
    const id = ids.current.get(idOrKey) ?? idOrKey;
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, ...change } : n)));
    if (String(id).startsWith('pending-')) drafts.current.set(id, { ...(drafts.current.get(id) ?? {}), ...change });
    else autosave.edit(id, change);
  }, [autosave]);

  /** C22.4: a note moved to another passage ({ scope, anchors, start, end }), saved at once, in book order again. */
  const relink = useCallback((id, place) => {
    const change = { scope: place.scope, anchors: place.anchors, position_start: place.start, position_end: place.end };
    setNotes((list) => inBookOrder(list.map((n) => (n.id === id ? { ...n, ...change } : n))));
    if (String(id).startsWith('pending-')) drafts.current.set(id, { ...(drafts.current.get(id) ?? {}), ...change });
    else { autosave.edit(id, change); autosave.flush(id); }
  }, [autosave]);

  const remove = useCallback(async (id) => {
    const before = notes.find((n) => n.id === id);
    if (!before || before.pending) return;
    setNotes((list) => list.filter((n) => n.id !== id));
    try {
      await notesApi.remove(id);
      autosave.forget(id);
      const { kind, scope, anchors, position_start, position_end, content } = before;
      toast({ kind: 'neutral', message: 'Note deleted.',
        action: { label: 'Undo', onClick: () => create({ kind, scope, anchors, position_start, position_end, content }) } });
    } catch {
      setNotes((list) => inBookOrder([...list, before]));
      toast({ kind: 'warning', message: "That note wasn't deleted. Try again." });
    }
  }, [notes, toast, create, autosave]);

  // C22.3: a drawing's PNG thumbnail goes to the notes bucket and its path onto the note (saved at once).
  const attachThumbnail = useCallback(async (note, blob) => {
    if (!blob || note.pending) return;
    try {
      const { path, url } = await notesApi.upload(bookId, { content_type: 'image/png', data: await base64Of(blob) });
      setNotes((list) => list.map((n) => (n.id === note.id ? { ...n, thumbnail_path: path, urls: { ...(n.urls ?? {}), [path]: url } } : n)));
      autosave.edit(note.id, { thumbnail_path: path });
      autosave.flush(note.id);
    } catch {
      toast({ kind: 'warning', message: "The drawing is saved, but its picture in the list wasn't. It is made again next time you press Done." });
    }
  }, [bookId, autosave, toast]);

  /** C22.6: a crop (base64 PNG) into the notes bucket: { path, url }. C37.6: or a page's picture (WebP or PNG), its
   * signed URL added to that page's `urls` so the page can show it again this visit. */
  const uploadImage = useCallback(async (data, contentType = 'image/png', noteId = null) => {
    const made = await notesApi.upload(bookId, { content_type: contentType, data });
    if (noteId) setNotes((list) => list.map((n) => (n.id === noteId || n.key === noteId ? { ...n, urls: { ...(n.urls ?? {}), [made.path]: made.url } } : n)));
    return made;
  }, [bookId]);

  const keepMine = useCallback((id) => autosave.keepMine(id), [autosave]);
  const takeTheirs = useCallback(async (id) => {
    const rows = await notesApi.list(bookId).catch(() => null);
    const theirs = rows?.find((n) => n.id === id);
    if (!theirs) return;
    await autosave.takeTheirs(id, theirs.version);
    setNotes((list) => list.map((n) => (n.id === id ? theirs : n)));
  }, [bookId, autosave]);

  return { notes, state, statuses, reload, create, edit, relink, remove, uploadImage, keepMine, takeTheirs, attachThumbnail, flush: autosave.flush };
}
