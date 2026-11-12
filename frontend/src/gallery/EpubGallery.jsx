import { useCallback, useRef, useState } from 'react';
import { EpubView } from '../originalview/epub/EpubView';
import './gallery.css';

const FIXTURES = ['reflow', 'fixed', 'hostile'];
const params = new URLSearchParams(globalThis.location?.search ?? '');
// For the scratchpad checks: the engine, and ms from each turn to its relocate.
const probe = (globalThis.__epub ??= { engine: null, turns: [], turnStart: null, relocations: 0 });

/**
 * Dev-only /__epub (C17.3): the EPUB renderer on a fixture from e2e/fixtures/books
 * (?book=reflow|fixed|hostile; Vite dev serves the folder) or a chosen file, with
 * page turns, the Publisher / ReadFocus style switch and text size.
 */
export default function EpubGallery() {
  const [fixture, setFixture] = useState(params.get('book') ?? 'reflow');
  const [file, setFile] = useState(null);
  const [style, setStyle] = useState('publisher');
  const [size, setSize] = useState(18);
  const [where, setWhere] = useState('');
  const view = useRef(null);
  const load = useCallback(async () => (file
    ? { data: new Uint8Array(await file.arrayBuffer()) }
    : { url: `/e2e/fixtures/books/${fixture}.epub` }), [file, fixture]);
  const onRelocate = useCallback((location) => {
    probe.relocations += 1;
    if (probe.turnStart) probe.turns.push(performance.now() - probe.turnStart);
    probe.turnStart = null;
    setWhere(`${Math.round((location.fraction ?? 0) * 100)}% · ${location.tocItem?.label ?? ''}`);
  }, []);
  const turn = (dir) => {
    probe.turnStart = performance.now();
    return dir > 0 ? view.current?.next() : view.current?.prev();
  };

  return (
    <main className="gallery">
      <header className="gallery-header">
        <h1>EPUB renderer</h1>
        <p>
          <select aria-label="Fixture" value={fixture} onChange={(e) => { setFile(null); setFixture(e.target.value); }}>
            {FIXTURES.map((name) => <option key={name}>{name}</option>)}
          </select>{' '}
          <input type="file" accept=".epub" aria-label="Open an EPUB" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </p>
      </header>
      <p>
        <button type="button" onClick={() => turn(-1)}>Previous</button>{' '}
        <button type="button" onClick={() => turn(1)}>Next</button>{' '}
        <button type="button" aria-pressed={style === 'publisher'} onClick={() => setStyle('publisher')}>Publisher style</button>{' '}
        <button type="button" aria-pressed={style === 'readfocus'} onClick={() => setStyle('readfocus')}>ReadFocus style</button>{' '}
        <button type="button" onClick={() => setSize((s) => Math.max(14, s - 2))} disabled={style !== 'readfocus'}>A−</button>{' '}
        <button type="button" onClick={() => setSize((s) => Math.min(28, s + 2))} disabled={style !== 'readfocus'}>A+</button>{' '}
        <span>{where}</span>
      </p>
      <div style={{ height: 'min(80vh, 760px)', border: '1px solid var(--line)' }}>
        <EpubView ref={view} key={file?.name ?? fixture} bookId={file?.name ?? fixture} load={load} style={style} fontSize={size}
          onRelocate={onRelocate} onReady={(engine) => { probe.engine = engine; }} label="Test book" />
      </div>
    </main>
  );
}
