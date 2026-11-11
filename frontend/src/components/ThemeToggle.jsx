import { useRef } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../theme/themeContext';
import './ThemeToggle.css';

const OPTIONS = [
  { value: 'paper', label: 'Paper (light)', Icon: Sun },
  { value: 'lamplight', label: 'Lamplight (dark)', Icon: Moon },
  { value: 'system', label: 'Match system', Icon: Monitor },
];

/**
 * Theme control in the handoff's pill style: the chosen option is the
 * accent knob (accent-ink icon, glow in Lamplight) and the knob slides
 * over --dur-3. A radio group: Tab reaches the chosen option, arrow keys
 * move and choose, every option has a label.
 */
export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const refs = useRef([]);
  const index = Math.max(0, OPTIONS.findIndex((o) => o.value === choice));

  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    setChoice(OPTIONS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className="rf-theme-toggle" role="radiogroup" aria-label="Theme" onKeyDown={onKeyDown}>
      <span className="rf-theme-toggle__knob" style={{ transform: `translateX(${index * 100}%)` }} aria-hidden="true" />
      {OPTIONS.map(({ value, label, Icon }, i) => (
        <button
          key={value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          tabIndex={choice === value ? 0 : -1}
          className="rf-theme-toggle__option"
          onClick={() => setChoice(value)}
        >
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
