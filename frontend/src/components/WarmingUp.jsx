import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { ReadingLamp, TeaCup } from '../illustrations';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import './WarmingUp.css';

const LINES = ['Lighting the lamp…', 'Pouring the tea…', 'Dusting the shelves…', 'Finding your page…'];
const ROTATE_MS = 2600; // handoff moment 7

/**
 * Warming up the reading room (handoff screen 02, moment 7): shown while a
 * sleeping backend wakes. The lamp brightens over 6 s, steam rises from
 * the tea and a short line changes every 2.6 s. The steam and the line go
 * on for as long as the wait, so a pause control stops them (WCAG 2.2.2);
 * under reduced motion the steam does not loop (base.css).
 */
export function WarmingUp() {
  useDocumentTitle('Warming up');
  const [paused, setPaused] = useState(false);
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => setLine((n) => (n + 1) % LINES.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  return (
    <main className="rf-warm" data-paused={paused ? 'on' : undefined}>
      <div className="rf-warm__scene" aria-hidden="true">
        <TeaCup animated className="rf-warm__tea" />
        <ReadingLamp className="rf-warm__lamp" />
      </div>
      <div className="rf-warm__text">
        <p className="eyebrow">ReadFocus</p>
        <h1 className="rf-warm__title">Warming up the reading room…</h1>
        <p className="rf-warm__body" role="status">
          The reading room has been resting. Waking it can take up to a minute the first time. Thanks for waiting.
        </p>
        <div className="rf-warm__line" aria-hidden="true"><span /></div>
        <div className="rf-warm__foot">
          <p className="rf-warm__rotating" aria-hidden="true" key={line}>{LINES[line]}</p>
          <button
            type="button"
            className="rf-warm__pause"
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play size={16} strokeWidth={1.75} aria-hidden="true" /> : <Pause size={16} strokeWidth={1.75} aria-hidden="true" />}
            <span>{paused ? 'Play animation' : 'Pause animation'}</span>
          </button>
        </div>
      </div>
    </main>
  );
}
