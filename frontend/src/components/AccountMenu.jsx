import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { fadeIn, pop } from '../motion/presets';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../theme/themeContext';
import { displayName, initials } from '../lib/initials';
import { SIZES, readSize, storeSize } from '../reader/textSize';
import { ThemeToggle } from './ThemeToggle';
import { OwnKeyForm } from '../steve/OwnKeyForm';
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
 * settings (text size, theme, accent), Steve's own-key setting (C20.3) and Sign out. The panel mixes form
 * controls with a button, so it is a disclosure (aria-expanded,
 * aria-controls), not an ARIA menu. Esc closes it and returns focus to the
 * button; a press outside closes it. The theme toggle sits here, and in
 * the bar only from 640 px up. The panel slides down a few pixels as it
 * opens (pop) and fades out; under reduced motion it only fades.
 */
export function AccountMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { accent, setAccent } = useTheme();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(readSize);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const panelId = useId();
  const name = displayName(user);
  const reduced = useReducedMotion();
  // Sign out goes to sign in, as before C13.10a: "/" signed out is now the landing page,
  // so it is named here instead of left to the Library route's redirect.
  const leave = () => {
    navigate('/login', { replace: true });
    signOut();
  };

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
        aria-controls={open ? panelId : undefined}
        aria-label="Account and reading settings"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{initials(user)}</span>
      </button>
      <AnimatePresence>
      {open && (
      <m.div
        key="panel"
        id={panelId}
        className="rf-account__panel"
        variants={reduced ? fadeIn : pop}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
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
        <section className="rf-account__settings" aria-labelledby={`${panelId}-steve`}>
          <h2 id={`${panelId}-steve`} className="eyebrow">Steve</h2>
          <OwnKeyForm />
        </section>
        <button type="button" className="rf-account__signout" onClick={leave}>
          <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </m.div>
      )}
      </AnimatePresence>
    </div>
  );
}
