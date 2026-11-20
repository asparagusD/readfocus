import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

/**
 * Edge's find bar (C38.5, issue 22), over the top right of the book: the query, where the reader is among the
 * matches ("3 of 47"), previous and next, and close. Enter goes to the next match and Shift+Enter the previous;
 * Escape closes it. `finder` is useFind's; the count is spoken once the whole book has been searched.
 */
export function FindBar({ finder }) {
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [finder.focusKey]);
  const none = !finder.count;
  return (
    <div className="rf-find" role="search" aria-label="Find in the book">
      <Search className="rf-find-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      <input ref={input} type="text" className="rf-find-input" aria-label="Find in the book" placeholder="Find in the book"
        enterKeyHint="search" autoComplete="off" spellCheck={false} value={finder.query}
        onChange={(event) => finder.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) finder.prev();
            else finder.next();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finder.close();
          }
        }} />
      <span className="rf-find-count" aria-hidden="true">{finder.status}</span>
      <span className="sr-only" role="status">{finder.done ? finder.status : ''}</span>
      <button type="button" className="rf-tool" onClick={finder.prev} disabled={none} aria-label="Previous match"
        aria-keyshortcuts="Shift+Enter">
        <ChevronUp size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="rf-tool" onClick={finder.next} disabled={none} aria-label="Next match"
        aria-keyshortcuts="Enter">
        <ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="rf-tool" onClick={finder.close} aria-label="Close find" aria-keyshortcuts="Escape">
        <X size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
