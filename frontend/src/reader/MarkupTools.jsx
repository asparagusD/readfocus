import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Eraser, Highlighter, PenLine, Type } from 'lucide-react';
import { toggleTool } from '../annotations/markup';
import { WIDTHS } from '../annotations/ink';
import { TEXT_SIZES } from '../annotations/textbox';
import { COLOURS, colourName, MARK_COLOURS } from '../annotations/palette';
import { rove } from '../annotations/roving';
import '../annotations/SelectionToolbar.css';

const ICONS = { draw: PenLine, erase: Eraser, highlight: Highlighter, text: Type };
const points = (n) => `${n} ${n === 1 ? 'point' : 'points'}`;

/**
 * One of Edge's markup tools in the reader's toolbar (C39.3, issue 23): the tool, a toggle (pressed while on; the
 * colour in use as a bar under its icon), and its menu, a small panel under it with the tool's options: its colours
 * (`colours`, named by `attr`: data-colour for a highlight's, data-mark-colour for ink) and its sliders (`sliders`:
 * Draw's thickness, C39.4; Add text's size, C39.6), each over a list of point values. Picking a colour or a value turns
 * the tool on; a menu with no sliders closes on a pick, one with sliders stays open. Escape or a press outside closes
 * it, focus back on its button.
 */
function MarkupTool({ tool, on, colours, attr, colour, onColour, sliders = [], onToggle }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef(null);
  const menu = useRef(null);
  const Icon = ICONS[tool.id];
  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector('[aria-checked="true"]')?.focus();
    const away = (event) => {
      if (!menu.current?.contains(event.target) && !menuButton.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const close = () => {
    setOpen(false);
    menuButton.current?.focus();
  };
  const onMenuKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation(); // the menu closes; the tool and More tools stay as they are
      close();
    } else if (event.target.getAttribute('role') === 'radio') rove(event, event.target.parentElement);
  };
  const id = `rf-markup-${tool.id}`;
  return (
    <div className="rf-markup-tool" data-keeps-more>
      <button type="button" className="rf-tool rf-markup-toggle" aria-pressed={on} onClick={onToggle}
        aria-label={tool.label} title={on ? `${tool.label} (Escape to stop)` : tool.label}>
        <span className="rf-markup-icon" aria-hidden="true">
          <Icon size={18} strokeWidth={1.75} />
          {attr && <span className="rf-markup-swatch" {...{ [attr]: colour }} />}
        </span>
        <span className="rf-tool-label">{tool.label}</span>
      </button>
      {tool.menu && ( // C39.5: Erase has no menu, as in Edge
        <button type="button" className="rf-tool rf-markup-menu-button" ref={menuButton} aria-expanded={open}
          aria-controls={open ? id : undefined} aria-label={tool.menu} onClick={() => setOpen(!open)}>
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {open && (
        <div id={id} ref={menu} className="rf-seltool rf-markup-menu" role="group" aria-label={tool.menu} onKeyDown={onMenuKey}>
          <div className="rf-markup-colours" role="radiogroup" aria-label={`${tool.label} colour`}>
            {colours.map((c) => (
              <button key={c} type="button" role="radio" className="rf-seltool-dot" {...{ [attr]: c }} aria-checked={c === colour}
                tabIndex={c === colour ? 0 : -1} aria-label={colourName(c)} title={colourName(c)}
                onClick={() => { onColour(c); if (!sliders.length) close(); }}>
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
          {sliders.map((s) => (
            <label key={s.label} className="rf-markup-width">
              <span>{s.label}</span>
              <input type="range" min={0} max={s.values.length - 1} step={1} value={Math.max(0, s.values.indexOf(s.value))}
                aria-valuetext={points(s.value)} onChange={(event) => s.onChange(s.values[Number(event.target.value)])} />
              <output aria-hidden="true">{s.value} pt</output>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Edge's markup tools as a group in the reader's toolbar (C39.3): `tools` (markup.js toolsFor), the one on (`tool`,
 * null for none), `onTool(id | null)`, the highlighter's colour (`colour`, `onColour`) and, C39.4, Draw's ink
 * (`ink`: { colour, width }, `onInk(change)`); C39.6, Add text's style (`text`: { colour, size, width }, `onText`).
 * A live region says when a tool turns on or off (`status`).
 */
export function MarkupTools({ tools, tool, onTool, colour, onColour, ink, onInk, text, onText, status }) {
  if (!tools.length) return null;
  const options = {
    text: { colours: MARK_COLOURS, attr: 'data-mark-colour', colour: text.colour, onColour: (c) => onText({ colour: c }),
      sliders: [{ label: 'Size', values: TEXT_SIZES, value: text.size, onChange: (v) => onText({ size: v }) }] },
    draw: { colours: MARK_COLOURS, attr: 'data-mark-colour', colour: ink.colour, onColour: (c) => onInk({ colour: c }),
      sliders: [{ label: 'Thickness', values: WIDTHS, value: ink.width, onChange: (w) => onInk({ width: w }) }] },
    highlight: { colours: COLOURS, attr: 'data-colour', colour, onColour },
    erase: { colours: [], attr: null, colour: null, onColour: () => {} }, // C39.5: no options
  };
  return (
    <div className="rf-toolbar-group rf-markup" role="group" aria-label="Markup">
      {tools.map((t) => {
        const o = options[t.id];
        return (
          <MarkupTool key={t.id} tool={t} on={tool === t.id} colours={o.colours} attr={o.attr} colour={o.colour}
            onToggle={() => onTool(toggleTool(tool, t.id))} onColour={(c) => { o.onColour(c); onTool(t.id); }}
            sliders={(o.sliders ?? []).map((s) => ({ ...s, onChange: (v) => { s.onChange(v); onTool(t.id); } }))} />
        );
      })}
      <p className="sr-only" role="status">{status}</p>
    </div>
  );
}
