import { useCallback, useEffect, useMemo, useState } from 'react';
import { toolStatus, toolsFor } from './markup';
import { readInk, storeInk } from './ink';
import { readTextStyle, storeTextStyle } from './textbox';
import { COLOUR_EVENT, lastColour, MARK_COLOURS, storeLastColour } from './palette';

/**
 * Edge's markup tools in a reading session (C39.3, issue 23): the tools this book offers, the one on (null: the
 * pointer selects text), the highlighter's colour (the last colour picked on this device, shared with H and the
 * selection toolbar, and kept in step with them), and what a screen reader is told. Escape anywhere outside a field
 * or a dialog turns the tool off, as does `active` going false (focus mode takes the toolbar's place).
 * C39.4: Draw's ink colour and thickness (`ink`, `setInk`), kept on this device.
 * C39.6: Add text's colour, size and width (`textStyle`, `setTextStyle`), kept on this device.
 */
export function useMarkupTool(kind, active = true) {
  const tools = useMemo(() => toolsFor(kind), [kind]);
  const [tool, setTool] = useState(null);
  const [colour, setColourNow] = useState(lastColour);
  const [status, setStatus] = useState('');
  const [ink, setInkNow] = useState(() => readInk(MARK_COLOURS));
  const [textStyle, setTextStyleNow] = useState(() => readTextStyle(MARK_COLOURS));

  const choose = useCallback((next) => {
    setTool(next);
    setStatus(toolStatus(next, { colour: lastColour(), ink: readInk(MARK_COLOURS), text: readTextStyle(MARK_COLOURS) }));
  }, []);
  const setInk = useCallback((change) => setInkNow((now) => {
    const next = { ...now, ...change };
    storeInk(next);
    return next;
  }), []);
  const setTextStyle = useCallback((change) => setTextStyleNow((now) => {
    const next = { ...now, ...change };
    storeTextStyle(next);
    return next;
  }), []);
  const setColour = useCallback((next) => storeLastColour(next), []); // COLOUR_EVENT brings it back here

  useEffect(() => {
    const changed = (event) => setColourNow(event.detail);
    globalThis.addEventListener?.(COLOUR_EVENT, changed);
    return () => globalThis.removeEventListener?.(COLOUR_EVENT, changed);
  }, []);

  useEffect(() => {
    if (!tool) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target?.closest?.('input, textarea, select, [role="dialog"]')) return;
      choose(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tool, choose]);

  const [wasActive, setWasActive] = useState(active); // focus mode turns the tool off, not just hides it
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setTool(null);
  }

  return { tools, tool, choose, colour, setColour, ink, setInk, textStyle, setTextStyle, status };
}
