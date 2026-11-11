import { useState } from 'react';
import {
  ReadingLamp, BookStack, TeaCup, DuskWindow, EmptyShelf, OpenBook, CrescentMoon, Candle,
} from '../illustrations';
import './IllustrationGallery.css';

// Dev-only review page for the illustration set (C11.1), routed at
// /__illustrations only when import.meta.env.DEV (App.jsx), so it is not
// in the production build. The theme tokens are attribute selectors, so
// each panel draws its own theme x accent side by side.

const SET = [
  ['Reading lamp', ReadingLamp],
  ['Stack of books', BookStack],
  ['Tea · steam loops 3.2 s', TeaCup],
  ['Window at dusk', DuskWindow],
  ['Empty shelf', EmptyShelf],
  ['Open book with ribbon', OpenBook],
  ['Crescent moon', CrescentMoon],
  ['Candle', Candle],
];

const PANELS = [
  ['paper', 'terracotta'],
  ['paper', 'sage'],
  ['lamplight', 'terracotta'],
  ['lamplight', 'sage'],
];

function Panel({ theme, accent, animated, steam }) {
  return (
    <section
      className="ill-gallery-panel"
      data-theme={theme}
      data-accent={accent}
      aria-label={`${theme}, ${accent}`}
    >
      <h2 className="ill-gallery-panel-title">{theme} · {accent}</h2>
      <ul className="ill-gallery-grid">
        {SET.map(([label, Component]) => (
          <li key={label} className="ill-gallery-card">
            <Component
              animated={animated}
              {...(Component === TeaCup ? { steam } : {})}
            />
            <span className="ill-gallery-label">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function IllustrationGallery() {
  const [animated, setAnimated] = useState(true);
  const [steam, setSteam] = useState(true);
  return (
    <main className="ill-gallery">
      <header className="ill-gallery-head">
        <h1>Illustrations</h1>
        <p>Original set, C11.1. Line 1.6 px at every size; fills from the theme tokens.</p>
        <div className="ill-gallery-controls">
          <label><input type="checkbox" checked={animated} onChange={(e) => setAnimated(e.target.checked)} /> Ambient loops</label>
          <label><input type="checkbox" checked={steam} onChange={(e) => setSteam(e.target.checked)} /> Steam on the tea</label>
        </div>
      </header>

      {PANELS.map(([theme, accent]) => (
        <Panel key={`${theme}-${accent}`} theme={theme} accent={accent} animated={animated} steam={steam} />
      ))}

      <section className="ill-gallery-panel" aria-label="Sizes and naming">
        <h2 className="ill-gallery-panel-title">Sizes (64, 120, 200 px) and a named picture</h2>
        <div className="ill-gallery-sizes">
          <ReadingLamp size={64} />
          <ReadingLamp size={120} />
          <ReadingLamp size={200} />
          <TeaCup size={120} steam={false} title="An empty tea cup" />
        </div>
      </section>
    </main>
  );
}
