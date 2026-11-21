import { useEffect, useRef, useState } from 'react';
import { pagePoint } from '../../annotations/ink';
import { Move } from 'lucide-react';
import { ADD_TEXT_EVENT, boxStyle, moveBy, placeAt } from '../../annotations/textbox';

/**
 * Text boxes on one PDF page (C39.6, issue 23): this page's boxes (`boxes`, text marks) laid out from their PDF points,
 * so zoom only rescales them. With Add text on (`text`: { style, selected, onPlace, onEdit, onRemove, onSelect }) a
 * press on the page starts a new box there (kept inside the page) and Enter (ADD_TEXT_EVENT) starts one in the
 * middle of what shows of the page; typing fills it and leaving it (a press elsewhere, Tab, Escape) saves it, or
 * drops it when empty. A box is a button then: a click or Enter edits it again, and emptying it deletes it. With
 * Add text off the boxes are only drawn, and the words under them take the pointer.
 * C39.6c: the selected box has a move handle: dragged, the box follows and is saved where it is let go; with it
 * focused the arrow keys move it 4 points (16 with Shift).
 */
export function TextBoxes({ page, size, boxes, text }) {
  const layer = useRef(null);
  const [draft, setDraft] = useState(null); // { x, y } of a new box being typed
  const [editing, setEditing] = useState(null); // the id of a box being retyped
  const [moving, setMoving] = useState(null); // { id, from: [x, y], data } while a handle is dragged
  const pageSize = { width: size.width / size.scale, height: size.height / size.scale };
  const on = Boolean(text);

  const start = (at) => {
    setEditing(null);
    setDraft(placeAt(at, text.style, pageSize));
    text.onSelect(null);
  };

  const startRef = useRef(start);
  useEffect(() => { startRef.current = start; });
  useEffect(() => {
    if (!on) return undefined;
    const ask = (event) => {
      if (event.detail?.page !== page || !layer.current) return;
      const r = layer.current.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      const y = (top + bottom) / 2 - r.top; // the middle of what shows of the page
      startRef.current([(r.width * 0.15) / size.scale, Math.max(0, y) / size.scale]);
    };
    window.addEventListener(ADD_TEXT_EVENT, ask);
    return () => window.removeEventListener(ADD_TEXT_EVENT, ask);
  }, [on, page, size.scale]);

  if (!on && !boxes.length) return null;

  const onDown = (event) => {
    if (!on || event.target !== event.currentTarget) return; // a press on a box is its own
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); // no text selection; the new box takes focus
    const [x, y] = pagePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), size.scale, 0.5, pageSize);
    start([x, y]);
  };
  const grip = (b) => {
    const shown = moving?.id === b.id ? moving.data : b.data;
    const at = boxStyle(shown, size.scale);
    const point = (event) => [event.clientX / size.scale, event.clientY / size.scale];
    return (
      <button key={`grip-${b.id}`} type="button" className="rf-textbox-grip" style={{ left: at.left, top: at.top }}
        aria-label="Move text box" title="Move (drag, or the arrow keys)"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* moves uncaptured */ }
          setMoving({ id: b.id, from: point(event), data: b.data });
        }}
        onPointerMove={(event) => {
          if (moving?.id !== b.id) return;
          const [x, y] = point(event);
          setMoving({ ...moving, data: moveBy(b.data, x - moving.from[0], y - moving.from[1], pageSize) });
        }}
        onPointerUp={() => {
          if (moving?.id !== b.id) return;
          setMoving(null);
          if (moving.data.x !== b.data.x || moving.data.y !== b.data.y) text.onEdit(b.id, moving.data);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 16 : 4;
          const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
          if (!by) return;
          event.preventDefault();
          event.stopPropagation();
          text.onEdit(b.id, moveBy(b.data, by[0], by[1], pageSize));
        }}>
        <Move size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    );
  };
  const leave = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur(); } };

  return (
    <div ref={layer} className="rf-textboxes" data-placing={on || undefined} onPointerDown={onDown}>
      {boxes.map((b) => (editing === b.id && on ? (
        <textarea key={b.id} className="rf-textbox rf-textbox-edit" data-mark-colour={b.color} defaultValue={b.data.text}
          style={boxStyle(b.data, size.scale)} aria-label={`Text box on page ${page}`} maxLength={2000} autoFocus
          onKeyDown={leave} onBlur={(event) => {
            setEditing(null);
            const value = event.target.value;
            if (!value.trim()) text.onRemove(b.id);
            else if (value !== b.data.text) text.onEdit(b.id, { ...b.data, text: value });
          }} />
      ) : (
        <div key={b.id} className="rf-textbox" data-id={b.id} data-mark-colour={b.color}
          data-selected={on && text.selected === b.id ? true : undefined}
          style={boxStyle(moving?.id === b.id ? moving.data : b.data, size.scale)}
          {...(on && {
            role: 'button', tabIndex: 0, 'aria-label': `Text box: ${b.data.text}. Edit`,
            onClick: () => { setDraft(null); setEditing(b.id); text.onSelect(b.id); },
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              event.stopPropagation();
              setEditing(b.id);
              text.onSelect(b.id);
            },
          })}>
          {b.data.text}
        </div>
      )))}
      {on && boxes.filter((b) => b.id === text.selected && editing !== b.id && !String(b.id).startsWith('pending')).map(grip)}
      {draft && on && (
        <textarea className="rf-textbox rf-textbox-edit" data-mark-colour={text.style.colour} maxLength={2000} autoFocus
          style={boxStyle({ ...draft, width: text.style.width, size: text.style.size }, size.scale)}
          aria-label={`New text box on page ${page}`} onKeyDown={leave}
          onBlur={(event) => {
            const value = event.target.value;
            setDraft(null);
            if (value.trim()) text.onPlace(page, draft, value);
          }} />
      )}
    </div>
  );
}
