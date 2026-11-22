import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { colourName, FIRST_COLOURS, MORE_COLOURS } from './palette';

/**
 * The colour dots of the selection toolbar and the highlight chip (C39.2, issue 23 D3): the handoff's five, then
 * More colours, which opens Edge's red and the deeper five on a second row under them. It opens by itself when
 * `current` (the colour in use, or H's colour) is one of those, so it is always shown. One grid, so the rows line up;
 * the buttons stay in the bar's roving order (roving.js). `pressed` marks `current` with aria-pressed (the chip),
 * otherwise it is only outlined (the toolbar: what H and U use).
 */
export function ColourDots({ current, onPick, label = colourName, title, pressed = false, firstTab = true, disabled = false }) {
  const [opened, setOpened] = useState(null); // null: follow `current`; true or false once the reader chose
  const more = opened ?? MORE_COLOURS.includes(current);
  const dot = (colour, i) => (
    <button key={colour} type="button" className="rf-seltool-dot" data-colour={colour} tabIndex={firstTab && i === 0 ? 0 : -1}
      data-last={colour === current || undefined} aria-pressed={pressed ? colour === current : undefined}
      aria-label={label(colour)} title={title?.(colour) ?? colourName(colour)} disabled={disabled} onClick={() => onPick(colour)}>
      <span aria-hidden="true" />
    </button>
  );
  return (
    <span className="rf-seltool-colours" data-more={more || undefined}>
      {FIRST_COLOURS.map(dot)}
      <button type="button" className="rf-seltool-more" tabIndex={-1} aria-expanded={more}
        aria-label="More colours" title={more ? 'Fewer colours' : 'More colours'} onClick={() => setOpened(!more)}>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {more && MORE_COLOURS.map((colour, i) => dot(colour, i + FIRST_COLOURS.length))}
    </span>
  );
}
