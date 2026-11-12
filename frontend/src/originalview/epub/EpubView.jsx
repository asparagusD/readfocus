import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { fromBook } from '../bookFile';
import './epub.css';

/**
 * An EPUB as published (C17.3): the publisher's XHTML, CSS, images, MathML and code,
 * paged by foliate-js into the box this component fills (two pages side by side from
 * 1024 px, one below; fixed-layout books page by page). `load(bookId)` gives the file
 * (default: this device's copy, else the signed URL). `ref` gets { next, prev, goTo, contents }.
 * `style` is 'publisher' or 'readfocus' (Lora at `fontSize`).
 */
export function EpubView({ bookId, load = fromBook, style = 'publisher', fontSize = 18, onRelocate, onLoad, onReady, ref, label = 'Book' }) {
  const box = useRef(null);
  const [engine, setEngine] = useState(null);
  const [failure, setFailure] = useState(null);
  const handlers = useRef({ onRelocate, onLoad, onReady });
  useEffect(() => { handlers.current = { onRelocate, onLoad, onReady }; });
  const initial = useRef({ style, fontSize });

  useEffect(() => {
    let opened = null;
    let gone = false;
    Promise.all([load(bookId), import('./engine')])
      .then(([source, { openEpub }]) => openEpub(source, box.current, {
        onRelocate: (location) => handlers.current.onRelocate?.(location),
        onLoad: (detail) => handlers.current.onLoad?.(detail),
        ...initial.current,
      }))
      .then((made) => {
        opened = made;
        if (gone) return made.close();
        setEngine(made);
        handlers.current.onReady?.(made);
      })
      .catch((error) => !gone && setFailure(error));
    return () => {
      gone = true;
      opened?.close();
    };
  }, [bookId, load]);

  useEffect(() => { engine?.setStyle(style, { fontSize }); }, [engine, style, fontSize]);
  useImperativeHandle(ref, () => engine && {
    next: engine.next, prev: engine.prev, goTo: engine.goTo, contents: engine.contents, isFixedLayout: engine.isFixedLayout,
  }, [engine]);

  return (
    <div className="rf-epub" role="document" aria-label={label} aria-busy={!engine && !failure}>
      <div ref={box} className="rf-epub__pages" />
      {failure && <p className="rf-epub__error" role="alert">This book could not be opened: {failure.message}</p>}
    </div>
  );
}
