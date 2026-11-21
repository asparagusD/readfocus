import { useEffect, useRef } from 'react';

const WIDTH = 112; // CSS px: two thumbnails across the pane

/** Free a thumbnail's pixels. */
function release(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

/**
 * The Pages tab (C38.6b, issue 22: Edge's thumbnails): every page of a PDF as a small picture with its printed
 * label, the page in view marked and scrolled to when the tab opens; a pick goes to that page. A thumbnail is drawn
 * (`thumbnail(page, width)` resolves a canvas) only while it is within 240 px of the list's view, and freed once it
 * is not, so a long book costs a screenful of thumbnails, not one for every page.
 */
export function PagesPanel({ total, current, labelOf, thumbnail, onPick }) {
  const list = useRef(null);
  const make = useRef(thumbnail);
  useEffect(() => { make.current = thumbnail; });
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
  }, []); // once, as the tab opens

  useEffect(() => {
    const root = list.current;
    if (!root || typeof IntersectionObserver !== 'function') return undefined;
    const drawn = new Map(); // page -> its canvas, or 'pending' while it is drawn
    const observer = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        const n = Number(target.dataset.page);
        if (isIntersecting && !drawn.has(n)) {
          drawn.set(n, 'pending');
          Promise.resolve(make.current?.(n, WIDTH)).then((canvas) => {
            if (drawn.get(n) !== 'pending' || !canvas) {
              release(canvas);
              return;
            }
            drawn.set(n, canvas);
            canvas.style.width = ''; // the sheet's width, so it fits its column
            canvas.style.height = '';
            target.querySelector('.rf-thumb-sheet')?.replaceChildren(canvas);
            target.dataset.drawn = '';
          }).catch(() => drawn.delete(n));
        } else if (!isIntersecting && drawn.has(n)) {
          release(drawn.get(n) === 'pending' ? null : drawn.get(n));
          drawn.delete(n);
          delete target.dataset.drawn;
        }
      }
    }, { root, rootMargin: '240px 0px' });
    for (const item of root.querySelectorAll('[data-page]')) observer.observe(item);
    return () => {
      observer.disconnect();
      for (const canvas of drawn.values()) if (canvas !== 'pending') release(canvas);
    };
  }, [total]);

  return (
    <ol className="rf-pages-list" ref={list}>
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const label = labelOf(n);
        return (
          <li key={n}>
            <button type="button" className="rf-thumb" data-page={n} aria-current={n === current ? 'true' : undefined}
              aria-label={`Page ${label}`} onClick={() => onPick(n)}>
              <span className="rf-thumb-sheet" aria-hidden="true" />
              <span className="rf-thumb-label" aria-hidden="true">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
