import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from '../lib/api';
import { useToast } from '../components/ui/toastContext';
import { BLOCK, blocksFor } from './ink';

/**
 * A PDF's ink strokes and text boxes (C39.4, issue 23; API from C39.1): loaded a block of 20 pages at a time as the
 * pages near the view (`pages`) reach it, so a long book never loads them all. `create(body)` shows the new mark at
 * once and saves it; if the server refuses it is taken back with a toast. An EPUB has none (D2): `kind` not 'pdf'.
 * C39.5: `erase(ids)` takes marks away at once and deletes them, returning what it took (for one Undo); a delete
 * the server refuses puts that mark back with a toast. `restore(rows)` saves them again (new ids), the Undo.
 * C39.6: `change(id, { color, data })` (a text box retyped, moved or restyled) shows at once and saves it; a change
 * the server refuses is taken back with a toast.
 */
export function usePageMarks(bookId, kind, pages) {
  const [marks, setMarks] = useState([]);
  // The marks as last drawn, for erase and change: a setMarks updater may run later than the call (React defers it
  // while another update is pending on the component), so what it would find cannot be read back (DEBUG_LOG C39.6).
  const current = useRef(marks);
  useEffect(() => { current.current = marks; }, [marks]);
  const loaded = useRef(new Set());
  const pending = useRef(0);
  const { toast } = useToast();
  const want = kind === 'pdf' && bookId ? blocksFor(pages).join() : '';

  useEffect(() => { loaded.current = new Set(); }, [bookId]);
  useEffect(() => {
    if (!want) return;
    for (const block of want.split(',').map(Number)) {
      if (loaded.current.has(block)) continue;
      loaded.current.add(block);
      const first = block * BLOCK + 1;
      fetchApi(`/books/${bookId}/marks?first=${first}&last=${first + BLOCK - 1}`)
        .then((data) => setMarks((now) => {
          const have = new Set(now.map((m) => m.id));
          return [...now, ...(data.marks ?? []).filter((m) => !have.has(m.id))];
        }))
        .catch(() => loaded.current.delete(block)); // asked again when the view comes back to it
    }
  }, [bookId, want]);

  const create = useCallback(async (body) => {
    const id = `pending-mark-${(pending.current += 1)}`;
    setMarks((list) => [...list, { ...body, id, pending: true }]);
    try {
      const saved = await fetchApi(`/books/${bookId}/marks`, { method: 'POST', body: JSON.stringify(body) });
      setMarks((list) => list.map((m) => (m.id === id ? saved : m)));
      return saved;
    } catch {
      setMarks((list) => list.filter((m) => m.id !== id));
      toast({ kind: 'warning', message: `That ${body.kind === 'ink' ? 'drawing' : 'text box'} wasn't saved. Try again.` });
      return null;
    }
  }, [bookId, toast]);

  const erase = useCallback((ids) => {
    const gone = current.current.filter((m) => ids.includes(m.id) && !m.pending);
    if (!gone.length) return gone;
    setMarks((list) => list.filter((m) => !gone.some((g) => g.id === m.id)));
    for (const m of gone) {
      fetchApi(`/marks/${m.id}`, { method: 'DELETE' }).catch(() => {
        setMarks((list) => [...list, m]);
        toast({ kind: 'warning', message: "That drawing wasn't erased. Try again." });
      });
    }
    return gone;
  }, [toast]);

  const restore = useCallback((rows) => Promise.all(rows.map(({ kind, page, color, data }) => create({ kind, page, color, data }))),
    [create]);

  const change = useCallback(async (id, patch) => {
    const before = current.current.find((m) => m.id === id);
    if (!before || before.pending) return;
    setMarks((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    try {
      const saved = await fetchApi(`/marks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setMarks((list) => list.map((m) => (m.id === id ? saved : m)));
    } catch {
      setMarks((list) => list.map((m) => (m.id === id ? before : m)));
      toast({ kind: 'warning', message: "That text box wasn't changed. Try again." });
    }
  }, [toast]);

  return { marks, create, erase, restore, change };
}
