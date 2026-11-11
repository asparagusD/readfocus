import { useEffect } from 'react';

/** Sets the tab title to "<title> · ReadFocus" while the page is shown (audit U11). */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · ReadFocus` : 'ReadFocus';
  }, [title]);
}
