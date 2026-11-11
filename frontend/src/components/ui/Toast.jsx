import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { Bookmark, Check, CircleAlert, X } from 'lucide-react';
import { fadeIn, pop } from '../../motion/presets';
import { ToastContext } from './toastContext';
import './Toast.css';

const ICONS = { success: Check, neutral: Bookmark, warning: CircleAlert };
const LIFETIME = 5000; // handoff: toasts stay 5 s (a behaviour delay, not an animation)

/**
 * Toasts from the handoff, bottom left: `success` and `neutral` on an ink
 * fill (dark in Paper, light in Lamplight), `warning` on --warn-soft.
 * Each lasts 5 s; hovering or focusing it pauses the timer. Announced
 * politely through a live region that is always mounted.
 * Usage (toastContext.js): const { toast } = useToast(); toast({ kind, message, action }).
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback((toast) => {
    const id = ++nextId.current;
    setToasts((list) => [...list, { kind: 'neutral', ...toast, id }]);
    return id;
  }, []);
  const api = useMemo(() => ({ toast: show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section className="rf-toasts" aria-label="Notifications" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
        </AnimatePresence>
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }) {
  const { kind, message, action, duration = LIFETIME } = toast;
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const Icon = ICONS[kind] ?? Bookmark;

  useEffect(() => {
    if (paused) return undefined;
    const started = Date.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, onDismiss]);

  return (
    <m.div
      className={`rf-toast rf-toast--${kind}`}
      variants={reduced ? fadeIn : pop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className="rf-toast__icon" size={18} strokeWidth={1.75} aria-hidden="true" />
      <p className="rf-toast__message">{message}</p>
      {action && (
        <button type="button" className="rf-toast__action" onClick={() => { action.onClick?.(); onDismiss(); }}>
          {action.label}
        </button>
      )}
      <button type="button" className="rf-toast__close" aria-label="Dismiss notification" onClick={onDismiss}>
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </m.div>
  );
}
