import { useEffect, useRef } from 'react';
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import './ReadAloudBar.css';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };

/**
 * Edge's read-aloud bar (C40.2, issue 24), over the top of the book while it reads: previous paragraph, play or
 * pause, next paragraph and stop. `reading` is useReadAloud's. The bar takes focus when it opens, on play or pause.
 */
export function ReadAloudBar({ reading, onClose }) {
  const play = useRef(null);
  useEffect(() => { play.current?.focus(); }, []);
  const status = reading.error ? 'Read aloud stopped: the voice could not go on.'
    : reading.ended ? 'Read aloud reached the end of the book.' : '';
  return (
    <div className="rf-read-aloud" role="region" aria-label="Read aloud">
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
      <button type="button" className="rf-tool" onClick={onClose} aria-label="Stop reading aloud">
        <X {...ICON} />
      </button>
      {status && <p className="rf-read-aloud-status">{status}</p>}
      <span className="sr-only" role="status">{status}</span>
    </div>
  );
}
