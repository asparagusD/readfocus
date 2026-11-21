import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Highlighter } from 'lucide-react';
import { toggleTool } from '../annotations/markup';
import { COLOURS, colourName } from '../annotations/palette';
import { rove } from '../annotations/roving';
import '../annotations/SelectionToolbar.css';

const ICONS = { highlight: Highlighter };

/**
 * One of Edge's markup tools in the reader's toolbar (C39.3, issue 23): the tool, a toggle (pressed while on; the
 * colour in use as a bar under its icon), and its menu, a small panel under it with the tool's options (Highlight:
 * Edge's ten colours, two rows). Picking a colour turns the tool on. Escape or a press outside closes the menu,
 * focus back on its button; the tool stays on.
 */
function MarkupTool({ tool, on, colour, onToggle, onColour }) {
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
    } else rove(event, menu.current);
  };
  const id = `rf-markup-${tool.id}`;
  return (
    <div className="rf-markup-tool" data-keeps-more>
      <button type="button" className="rf-tool rf-markup-toggle" aria-pressed={on} onClick={onToggle}
        aria-label={tool.label} title={on ? `${tool.label} (Escape to stop)` : tool.label}>
        <span className="rf-markup-icon" aria-hidden="true">
          <Icon size={18} strokeWidth={1.75} />
          <span className="rf-markup-swatch" data-colour={colour} />
        </span>
        <span className="rf-tool-label">{tool.label}</span>
      </button>
      <button type="button" className="rf-tool rf-markup-menu-button" ref={menuButton} aria-expanded={open}
        aria-controls={open ? id : undefined} aria-label={`${tool.label} colour`} onClick={() => setOpen(!open)}>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} ref={menu} className="rf-seltool rf-markup-menu" role="radiogroup" aria-label={`${tool.label} colour`}
          onKeyDown={onMenuKey}>
          {COLOURS.map((c) => (
            <button key={c} type="button" role="radio" className="rf-seltool-dot" data-colour={c} aria-checked={c === colour}
              tabIndex={c === colour ? 0 : -1} aria-label={colourName(c)} title={colourName(c)}
              onClick={() => { onColour(c); close(); }}>
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Edge's markup tools as a group in the reader's toolbar (C39.3): `tools` (markup.js toolsFor), the one on (`tool`,
 * null for none), `onTool(id | null)`, and the highlighter's colour (`colour`, `onColour`). A live region says when a
 * tool turns on or off (`status`).
 */
export function MarkupTools({ tools, tool, onTool, colour, onColour, status }) {
  if (!tools.length) return null;
  return (
    <div className="rf-toolbar-group rf-markup" role="group" aria-label="Markup">
      {tools.map((t) => (
        <MarkupTool key={t.id} tool={t} on={tool === t.id} colour={colour}
          onToggle={() => onTool(toggleTool(tool, t.id))} onColour={(c) => { onColour(c); onTool(t.id); }} />
      ))}
      <p className="sr-only" role="status">{status}</p>
    </div>
  );
}
