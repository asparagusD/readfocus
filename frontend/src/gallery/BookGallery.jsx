import { useCallback, useRef, useState } from 'react';
import { Reader } from '../originalview/Reader';
import { ReaderControls } from '../originalview/ReaderControls';
import { useLamplight } from '../originalview/useLamplight';
import { ReaderToolbar } from '../reader/ReaderToolbar';

const params = new URLSearchParams(globalThis.location?.search ?? '');
const KIND = params.get('kind') === 'epub' ? 'epub' : 'pdf';
const FILE = params.get('file') ?? (KIND === 'pdf' ? 'sample.pdf' : 'reflow.epub');
// For the scratchpad checks: the reader, the last place, and saved ribbons.
const probe = (globalThis.__book ??= { reader: null, place: null, bookmarks: [] });

/**
 * Dev-only /__book (C17.4): the shared book frame on a fixture from e2e/fixtures/books
 * (?kind=pdf|epub, ?file=name), with the reader toolbar and the original view's controls.
 */
export default function BookGallery() {
  const bookId = `fixture:${FILE}`;
  const load = useCallback(async () => ({ url: `/e2e/fixtures/books/${FILE}` }), []);
  const [zoom, setZoom] = useState('fit-page');
  const [settings, setSettings] = useState({ style: 'publisher', fontSize: 18, lineHeight: null, margins: 'normal' });
  const [entry, setEntry] = useState(null);
  const { theme, original, toggleOriginal } = useLamplight(bookId);
  const reader = useRef(null);
  const onRelocate = useCallback((place) => { probe.place = place; setEntry(place.entry); }, []);

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', height: '100dvh', paddingTop: 'var(--space-3)', background: 'var(--paper)' }}>
      <ReaderToolbar bookTitle={KIND === 'pdf' ? 'A sample PDF' : 'Reflow fixture'} chapter={entry} visible onFocusChange={() => {}}
        onBack={() => globalThis.history.back()}
        controls={(
          <ReaderControls kind={KIND} zoom={zoom} onZoom={setZoom} settings={settings} onSettings={setSettings}
            lamplight={theme === 'lamplight'} original={original} onOriginal={toggleOriginal} />
        )} />
      <Reader ref={(r) => { reader.current = r; probe.reader = r; }} kind={KIND} bookId={bookId} load={load}
        title={KIND === 'pdf' ? 'A sample PDF' : 'Reflow fixture'} zoom={zoom} settings={settings}
        onRelocate={onRelocate} onBookmark={(anchor) => probe.bookmarks.push(anchor)} />
    </div>
  );
}
