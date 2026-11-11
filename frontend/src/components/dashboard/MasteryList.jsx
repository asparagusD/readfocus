import { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { MasteryBar } from '../ui/MasteryBar';
import { SegmentedTabs } from '../ui/SegmentedTabs';
import { panelId, tabId } from '../ui/tabIds';
import { needsRevisiting } from '../../lib/dashboard';
import './MasteryList.css';

const PAGE = 10;

/**
 * Concept mastery (handoff screen 09): one underline tab per book in
 * progress, then that book's concepts weakest first from GET /mastery,
 * ten at a time with "Show more". Each row: the concept, its bar and
 * percentage, and "Needs revisiting" in words when it is weak.
 */
export function MasteryList({ books }) {
  const [bookId, setBookId] = useState(books[0]?.book_id ?? null);
  const [pages, setPages] = useState({}); // book id -> { items, total } | { error: true }
  const [offset, setOffset] = useState({}); // book id -> how many rows were asked for

  const shown = pages[bookId];
  const asked = offset[bookId] ?? PAGE;

  useEffect(() => {
    if (!bookId) return undefined;
    const have = pages[bookId]?.items?.length ?? 0;
    if (pages[bookId] && (pages[bookId].error || have >= asked || have >= pages[bookId].total)) return undefined;
    let live = true;
    fetchApi(`/mastery?book_id=${encodeURIComponent(bookId)}&limit=${PAGE}&offset=${have}`)
      .then((page) => {
        if (!live) return;
        setPages((all) => ({ ...all, [bookId]: { items: [...(all[bookId]?.items ?? []), ...page.items], total: page.total } }));
      })
      .catch(() => {
        if (live) setPages((all) => ({ ...all, [bookId]: { ...(all[bookId] ?? {}), error: true } }));
      });
    return () => { live = false; };
  }, [bookId, asked, pages]);

  if (!books.length) return null;
  const options = books.map((b) => ({ value: b.book_id, label: b.title }));
  const retry = () => setPages((all) => ({ ...all, [bookId]: all[bookId]?.items ? { ...all[bookId], error: false } : undefined }));

  return (
    <section className="rf-mastery-list" aria-labelledby="rf-mastery-title">
      <div className="rf-mastery-list__head">
        <h2 id="rf-mastery-title" className="rf-dash__h2">Concept mastery</h2>
        <p className="rf-dash__muted">Weakest first</p>
      </div>
      <SegmentedTabs idBase="rf-mastery" label="Books" options={options} value={bookId} onChange={setBookId} variant="underline" />
      <div role="tabpanel" id={panelId('rf-mastery')} aria-labelledby={tabId('rf-mastery', bookId)} className="rf-mastery-list__panel">
        {shown?.error && (
          <div className="rf-mastery-list__note" role="alert">
            <p>This book’s concepts didn’t load.</p>
            <Button variant="secondary" onClick={retry}>Try again</Button>
          </div>
        )}
        {!shown?.error && !shown && <Skeleton lines={4} />}
        {shown?.items?.length === 0 && !shown.error && (
          <p className="rf-dash__muted rf-mastery-list__note">No concepts yet for this book. They gather as you take its tests.</p>
        )}
        {shown?.items?.length > 0 && (
          <ul className="rf-mastery-list__rows">
            {shown.items.map((item) => {
              const pct = Math.round(item.mastery * 100);
              return (
                <li key={item.concept_key} className="rf-mastery-list__row">
                  <div className="rf-mastery-list__name">
                    <p className="rf-mastery-list__label">{item.label}</p>
                    {needsRevisiting(item) && <p className="rf-mastery-list__weak">Needs revisiting</p>}
                  </div>
                  <MasteryBar value={pct} className="rf-mastery-list__bar" />
                  <p className="rf-mastery-list__pct">{pct}%</p>
                </li>
              );
            })}
          </ul>
        )}
        {shown?.items && shown.items.length < shown.total && (
          <Button variant="ghost" onClick={() => setOffset((all) => ({ ...all, [bookId]: shown.items.length + PAGE }))}>
            Show more ({shown.total - shown.items.length} left)
          </Button>
        )}
      </div>
    </section>
  );
}
