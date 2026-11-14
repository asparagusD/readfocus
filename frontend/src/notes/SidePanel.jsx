import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import './SidePanel.css';

/**
 * The side area beside the book (C22.2; Steve's panel since C20.7b, handoff screens 13-19): tabs "Notes | Steve"
 * over one panel, a 380 px column from 760 px and a pull-up sheet below, so the book stays visible and usable.
 * The tabs are a WAI-ARIA tablist (arrows, Home, End). Opening focuses the chosen tab; Esc inside or the close
 * button closes it and focus goes back to the toolbar button that opened it. The panel is named after its tab.
 */
export function SidePanel({ tabs, current, onTab, onClose, returnTo, wide = false, children }) {
  const panel = useRef(null);
  const buttons = useRef({});
  const active = tabs.find((t) => t.id === current) ?? tabs[0];

  useEffect(() => {
    buttons.current[active.id]?.focus();
    const back = returnTo;
    return () => back?.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once: focus on open, give it back on close

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || !panel.current?.contains(document.activeElement)) return;
      // C22.3: Escape inside a drawing is Excalidraw's, even when it has already removed the text box it came from.
      if (event.target?.closest?.('[data-own-escape]') || event.target?.isConnected === false) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onTabKey = (event) => {
    const i = tabs.findIndex((t) => t.id === active.id);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    onTab(next.id);
    buttons.current[next.id]?.focus();
  };

  return (
    <aside ref={panel} id="rf-side-panel" className="rf-side" data-wide={wide || undefined} aria-label={active.label}>
      <span className="rf-side-grab" aria-hidden="true" />
      <header className="rf-side-head">
        <div className="rf-side-tabs" role="tablist" aria-label="Beside the book">
          {tabs.map((tab) => (
            <button key={tab.id} ref={(el) => { buttons.current[tab.id] = el; }} type="button" role="tab"
              id={`rf-side-tab-${tab.id}`} aria-selected={tab.id === active.id} aria-controls="rf-side-body"
              tabIndex={tab.id === active.id ? 0 : -1} className="rf-side-tab" onClick={() => onTab(tab.id)} onKeyDown={onTabKey}>
              {tab.mark}
              <span>{tab.label}</span>
              {tab.count > 0 && <span className="rf-side-count" aria-label={`, ${tab.count}`}>{tab.count}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="rf-side-x" onClick={onClose} aria-label={`Close ${active.label === 'Notes' ? 'notes' : active.label}`}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      <div id="rf-side-body" className="rf-side-body" role="tabpanel" aria-labelledby={`rf-side-tab-${active.id}`}>
        {children}
      </div>
    </aside>
  );
}
