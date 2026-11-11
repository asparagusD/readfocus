import { useRef } from 'react';
import { tabId, panelId } from './tabIds';
import './SegmentedTabs.css';

/**
 * Segmented tabs (C13.1a, sign-in screen): a tablist whose selected tab is
 * a raised surface pill. Roving tabindex; Left/Right, Home and End move and
 * select. The caller renders one panel with id panelId(idBase) and
 * aria-labelledby tabId(idBase, value).
 */
export function SegmentedTabs({ idBase, label, options, value, onChange, className = '' }) {
  const refs = useRef({});
  const select = (next) => {
    onChange(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (event) => {
    const index = options.findIndex((o) => o.value === value);
    const last = options.length - 1;
    const to = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    select(options[to].value);
  };
  return (
    <div role="tablist" aria-label={label} className={`rf-segmented ${className}`} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => { refs.current[option.value] = el; }}
            id={tabId(idBase, option.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idBase)}
            tabIndex={selected ? 0 : -1}
            className="rf-segmented__tab"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
