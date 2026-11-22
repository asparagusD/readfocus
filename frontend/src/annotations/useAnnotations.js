import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from '../lib/api';
import { useToast } from '../components/ui/toastContext';

/**
 * The reader's highlights and underlines in one book (C21.2; API from C21.1): loaded once, in reading order.
 * `create(body)` shows the new one at once and saves it; if the server refuses, it is taken back with a toast.
 * C21.4: `update(id, change)` (style or colour) and `remove(id)` work the same way; a delete offers Undo.
 * C39.5: `erase(ids)` takes several away with no toast of its own, returning them (the eraser offers one Undo for a
 * drag); `restore(rows)` saves them again.
 */
export function useAnnotations(bookId) {
  const [annotations, setAnnotations] = useState([]);
  const { toast } = useToast();
  const pending = useRef(0);

  useEffect(() => {
    if (!bookId) return undefined;
    let live = true;
    fetchApi(`/books/${bookId}/annotations`)
      .then((data) => { if (live) setAnnotations((now) => [...(data.annotations ?? []), ...now.filter((a) => a.pending)]); })
      .catch(() => {}); // the book reads the same without them; C21.5 lists what failed to load
    return () => { live = false; };
  }, [bookId]);

  const create = useCallback(async (body) => {
    const id = `pending-${(pending.current += 1)}`;
    setAnnotations((list) => [...list, { ...body, id, pending: true }]);
    try {
      const saved = await fetchApi(`/books/${bookId}/annotations`, { method: 'POST', body: JSON.stringify(body) });
      setAnnotations((list) => list.map((a) => (a.id === id ? saved : a)));
      return saved;
    } catch {
      setAnnotations((list) => list.filter((a) => a.id !== id));
      toast({ kind: 'warning', message: `That ${body.style} wasn't saved. Try again.` });
      return null;
    }
  }, [bookId, toast]);

  const update = useCallback(async (id, change) => {
    const before = annotations.find((a) => a.id === id);
    if (!before || before.pending) return;
    setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, ...change } : a)));
    try {
      const saved = await fetchApi(`/annotations/${id}`, { method: 'PATCH', body: JSON.stringify(change) });
      setAnnotations((list) => list.map((a) => (a.id === id ? saved : a)));
    } catch {
      setAnnotations((list) => list.map((a) => (a.id === id ? before : a)));
      toast({ kind: 'warning', message: `That ${before.style} wasn't changed. Try again.` });
    }
  }, [annotations, toast]);

  const remove = useCallback(async (id) => {
    const before = annotations.find((a) => a.id === id);
    if (!before || before.pending) return;
    setAnnotations((list) => list.filter((a) => a.id !== id));
    try {
      await fetchApi(`/annotations/${id}`, { method: 'DELETE' });
      const { anchors, style, color, position_start, position_end, comment } = before; // C39.8: its comment too
      toast({ kind: 'neutral', message: `${style === 'underline' ? 'Underline' : 'Highlight'} deleted.`,
        action: { label: 'Undo', onClick: () => create({ anchors, style, color, position_start, position_end, ...(comment && { comment }) }) } });
    } catch {
      setAnnotations((list) => [...list, before].sort((a, b) => a.position_start - b.position_start));
      toast({ kind: 'warning', message: `That ${before.style} wasn't deleted. Try again.` });
    }
  }, [annotations, toast, create]);

  const erase = useCallback((ids) => {
    const gone = annotations.filter((a) => ids.includes(a.id) && !a.pending);
    if (!gone.length) return gone;
    setAnnotations((list) => list.filter((a) => !gone.includes(a)));
    for (const a of gone) {
      fetchApi(`/annotations/${a.id}`, { method: 'DELETE' }).catch(() => {
        setAnnotations((list) => [...list, a].sort((x, y) => x.position_start - y.position_start));
        toast({ kind: 'warning', message: `That ${a.style} wasn't erased. Try again.` });
      });
    }
    return gone;
  }, [annotations, toast]);

  const restore = useCallback((rows) => Promise.all(rows.map(({ anchors, style, color, position_start, position_end, comment }) =>
    create({ anchors, style, color, position_start, position_end, ...(comment && { comment }) }))), [create]);

  return { annotations, create, update, remove, erase, restore };
}
