import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from '../lib/api';
import { useToast } from '../components/ui/toastContext';

/**
 * The reader's highlights and underlines in one book (C21.2; API from C21.1): loaded once, in reading order.
 * `create(body)` shows the new one at once and saves it; if the server refuses, it is taken back with a toast.
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

  return { annotations, create };
}
