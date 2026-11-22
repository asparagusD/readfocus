import { useEffect, useId, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, SlidersHorizontal, X } from 'lucide-react';
import { RATES, voiceLabel } from './speech';
import './ReadAloudBar.css';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };
const rateLabel = (rate) => `${rate}×`;

/**
 * Edge's read-aloud bar (C40.2, issue 24), over the top of the book while it reads: previous paragraph, play or
 * pause, next paragraph, Voice options (the system's voices and the speed, 0.5x to 2x) and stop. `reading` is
 * useReadAloud's. Escape in Voice options closes it; the bar takes focus when it opens, on play or pause.
 */
export function ReadAloudBar({ reading, onClose }) {
  const [options, setOptions] = useState(false);
  const optionsButton = useRef(null);
  const panel = useRef(null);
  const play = useRef(null);
  const id = useId();
  useEffect(() => { play.current?.focus(); }, []);
  useEffect(() => {
    if (!options) return undefined;
    const away = (event) => {
      if (!panel.current?.contains(event.target) && !optionsButton.current?.contains(event.target)) setOptions(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [options]);
  const status = reading.error ? 'Read aloud stopped: the voice could not go on.'
    : reading.ended ? 'Read aloud reached the end of the book.' : '';
  return (
    <div className="rf-read-aloud" role="region" aria-label="Read aloud" onKeyDown={(event) => {
      if (event.key === 'Escape' && options) {
        event.preventDefault();
        event.stopPropagation();
        setOptions(false);
        optionsButton.current?.focus();
      }
    }}>
      <button type="button" className="rf-tool" onClick={() => reading.skip(-1)} disabled={!reading.unit}
        aria-label="Previous paragraph">
        <SkipBack {...ICON} />
      </button>
      <button type="button" ref={play} className="rf-tool rf-read-aloud-play" onClick={reading.playing ? reading.pause : reading.resume}
        aria-label={reading.playing ? 'Pause' : 'Play'}>
        {reading.playing ? <Pause {...ICON} /> : <Play {...ICON} />}
      </button>
      <button type="button" className="rf-tool" onClick={() => reading.skip(1)} disabled={!reading.unit}
        aria-label="Next paragraph">
        <SkipForward {...ICON} />
      </button>
      <span className="rf-toolbar-rule" aria-hidden="true" />
      <button type="button" ref={optionsButton} className="rf-tool" onClick={() => setOptions((open) => !open)}
        aria-expanded={options} aria-controls={`${id}-options`} aria-label="Voice options">
        <SlidersHorizontal {...ICON} />
        <span className="rf-tool-label">Voice options</span>
      </button>
      <button type="button" className="rf-tool" onClick={onClose} aria-label="Stop reading aloud">
        <X {...ICON} />
      </button>
      {status && <p className="rf-read-aloud-status">{status}</p>}
      <span className="sr-only" role="status">{status}</span>
      <div id={`${id}-options`} ref={panel} className="rf-read-aloud-options" hidden={!options}>
        <label className="rf-read-aloud-field">
          <span>Voice</span>
          <select value={reading.voice?.voiceURI ?? ''} onChange={(event) => reading.setVoice(event.target.value)}
            disabled={!reading.voices.length}>
            {!reading.voices.length && <option value="">The system’s voice</option>}
            {reading.voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voiceLabel(voice)}</option>)}
          </select>
        </label>
        <label className="rf-read-aloud-field">
          <span>Speed <span className="rf-read-aloud-rate" aria-hidden="true">{rateLabel(reading.rate)}</span></span>
          <input type="range" min={0} max={RATES.length - 1} step={1} value={Math.max(0, RATES.indexOf(reading.rate))}
            aria-valuetext={rateLabel(reading.rate)} onChange={(event) => reading.setRate(RATES[Number(event.target.value)])} />
        </label>
      </div>
    </div>
  );
}
