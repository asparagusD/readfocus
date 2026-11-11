import { LoaderCircle } from 'lucide-react';
import './Button.css';

/**
 * Button from the handoff's component sheet: primary (accent fill),
 * secondary (surface, field border), ghost (no fill), plus danger.
 * While `loading` it shows a spinner and `loadingLabel` ("Grading…"),
 * keeps its colour, and is not clickable. Defaults to type="button".
 */
export function Button({
  children,
  variant = 'primary',
  loading = false,
  loadingLabel,
  disabled,
  type = 'button',
  className = '',
  ...props
}) {
  return (
    <button
      type={type}
      className={`rf-btn rf-btn--${variant} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <LoaderCircle className="rf-btn__spinner" size={18} strokeWidth={1.75} aria-hidden="true" />}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}
