import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/ui/toastContext';
import { createAutosave } from './autosave';
import { notesApi } from './notesApi';
import { createQueue, idbStore } from './queue';
import { inBookOrder } from './place';

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

  const create = useCallback(async (body) => {
    const id = `pending-${(made.current += 1)}`;
    setNotes((list) => inBookOrder([...list, { ...body, id, pending: true, version: 0, created_at: new Date().toISOString() }]));
    try {
      const saved = await notesApi.create(bookId, body);
      autosave.track(saved.id, saved.version);
      setNotes((list) => list.map((n) => (n.id === id ? { ...saved, content: n.content } : n)));
      return { id, saved };
    } catch {
      setNotes((list) => list.filter((n) => n.id !== id));
      toast({ kind: 'warning', message: "That note wasn't added. Try again." });
      return null;
    }
  }, [bookId, autosave, toast]);

  const edit = useCallback((id, change) => {
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, ...change } : n)));
    if (!String(id).startsWith('pending-')) autosave.edit(id, change);
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

  const keepMine = useCallback((id) => autosave.keepMine(id), [autosave]);
  const takeTheirs = useCallback(async (id) => {
    const rows = await notesApi.list(bookId).catch(() => null);
    const theirs = rows?.find((n) => n.id === id);
    if (!theirs) return;
    await autosave.takeTheirs(id, theirs.version);
    setNotes((list) => list.map((n) => (n.id === id ? theirs : n)));
  }, [bookId, autosave]);

  return { notes, state, statuses, reload, create, edit, remove, keepMine, takeTheirs, flush: autosave.flush };
}
