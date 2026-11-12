import { useCallback, useMemo, useState } from 'react';
import { ThemeToggle } from '../components/ThemeToggle';
import { BookReader } from '../reader';
import { createLookupClient } from '../reader/lookup';
import { fetchApi } from '../lib/api';
import { WALDEN_BLOCKS } from './readerFixture';
import './ReaderGallery.css';

const SIZES = [16.5, 18, 19.5];
const lookupClient = createLookupClient(fetchApi); // C12.8: the real /lookup (sign in first, or mock it)

/** The fixture repeated `copies` times, each copy in later chunks, so pagination can be timed on a longer text. */
function repeated(copies) {
  return Array.from({ length: copies }, (_, copy) => WALDEN_BLOCKS.map((b) => {
    const [chunk, n] = b.id.split('.');
    return { ...b, id: `${Number(chunk) + copy * 3}.${n}` };
  })).flat();
}

/**
 * Dev-only /__reader (C12.3): the paginated reader on a public-domain
 * fixture, with text size, length and theme controls, the current anchor
 * and the last pagination time (also on .rf-book as data-paginate-ms).
 */
export default function ReaderGallery() {
  const [size, setSize] = useState(18);
  const [copies, setCopies] = useState(1);
  const [place, setPlace] = useState(null);
  const [pages, setPages] = useState(null);
  const [looked, setLooked] = useState(null);
  const blocks = useMemo(() => repeated(copies), [copies]);
  const onPlaceChange = useCallback((anchor) => setPlace(anchor), []);
  // C12.7: what a hover or selection would look up (the card comes in C12.8).
  const onLookup = useCallback(({ kind, term, proper }) => setLooked({ kind, term, proper }), []);

  return (
    <div className="reader-gallery">
      <div className="reader-gallery-bar">
        <span className="reader-gallery-title">Reader · dev</span>
        <div className="reader-gallery-group" role="group" aria-label="Text size">
          {SIZES.map((s) => (
            <button key={s} type="button" aria-pressed={size === s} onClick={() => setSize(s)}>{s}px</button>
          ))}
        </div>
        <div className="reader-gallery-group" role="group" aria-label="Length">
          {[1, 4].map((c) => (
            <button key={c} type="button" aria-pressed={copies === c} onClick={() => setCopies(c)}>{c}×</button>
          ))}
        </div>
        <ThemeToggle />
        <output className="reader-gallery-place">
          {place ? `${place.block_id} @ ${place.char_offset}` : 'no turn yet'}
          {pages ? ` · ${pages.count} pages` : ''}
          {looked ? ` · ${looked.kind} “${looked.term}”${looked.proper ? ' (proper)' : ''}` : ''}
        </output>
      </div>
      <div className="reader-gallery-frame">
        <BookReader
          blocks={blocks}
          bookTitle="Walden"
          fontSize={size}
          onPlaceChange={onPlaceChange}
          onPagesChange={setPages}
          onLookup={onLookup}
          lookupClient={lookupClient}
        />
      </div>
    </div>
  );
}
