import { useEffect, useId, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/themeContext';
import { displayName, initials } from '../lib/initials';
import { SIZES, readSize, storeSize } from '../reader/textSize';
import { ThemeToggle } from './ThemeToggle';
import './AccountMenu.css';

const SIZE_LABELS = { 16.5: 'Small', 18: 'Medium', 19.5: 'Large' };
const ACCENTS = [{ value: 'terracotta', label: 'Terracotta' }, { value: 'sage', label: 'Sage' }];

/** A row of native radios drawn as a segmented control. */
function Choice({ legend, name, options, value, onChange }) {
  return (
    <fieldset className="rf-choice">
      <legend className="rf-choice__legend">{legend}</legend>
      <div className="rf-choice__row">
        {options.map((o) => (
          <label key={o.value} className="rf-choice__option" data-swatch={o.swatch}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The initials button and its account panel (D4): name and email, reading
 * settings (text size, theme, accent) and Sign out. The panel mixes form
 * controls with a button, so it is a disclosure (aria-expanded,
 * aria-controls), not an ARIA menu. Esc closes it and returns focus to the
 * button; a press outside closes it. The theme toggle sits here, and in
 * the bar only from 640 px up.
 */
export function AccountMenu() {
  const { user, signOut } = useAuth();
  const { accent, setAccent } = useTheme();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(readSize);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const panelId = useId();
  const name = displayName(user);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPress = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  const chooseSize = (next) => {
    const value = Number(next);
    storeSize(value);
    setSize(value);
  };

  return (
    <div className="rf-account" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="rf-account__button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Account and reading settings"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{initials(user)}</span>
      </button>
      <div id={panelId} className="rf-account__panel" hidden={!open}>
        <div className="rf-account__who">
          {name && <p className="rf-account__name">{name}</p>}
          <p className="rf-account__email">{user?.email}</p>
        </div>
        <section className="rf-account__settings" aria-labelledby={`${panelId}-settings`}>
          <h2 id={`${panelId}-settings`} className="eyebrow">Reading settings</h2>
          <Choice
            legend="Text size in the book"
            name={`${panelId}-size`}
            options={SIZES.map((s) => ({ value: String(s), label: SIZE_LABELS[s] }))}
            value={String(size)}
            onChange={chooseSize}
          />
          <div className="rf-account__theme">
            <span className="rf-choice__legend" aria-hidden="true">Theme</span>
            <ThemeToggle />
          </div>
          <Choice
            legend="Accent"
            name={`${panelId}-accent`}
            options={ACCENTS.map((a) => ({ ...a, swatch: a.value }))}
            value={accent}
            onChange={setAccent}
          />
        </section>
        <button type="button" className="rf-account__signout" onClick={signOut}>
          <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
