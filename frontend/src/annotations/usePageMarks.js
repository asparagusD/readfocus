import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from '../lib/api';
import { useToast } from '../components/ui/toastContext';
import { BLOCK, blocksFor } from './ink';

/**
 * A PDF's ink strokes and text boxes (C39.4, issue 23; API from C39.1): loaded a block of 20 pages at a time as the
 * pages near the view (`pages`) reach it, so a long book never loads them all. `create(body)` shows the new mark at
 * once and saves it; if the server refuses it is taken back with a toast. An EPUB has none (D2): `kind` not 'pdf'.
 */
export function usePageMarks(bookId, kind, pages) {
  const [marks, setMarks] = useState([]);
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

  return { marks, create };
}
