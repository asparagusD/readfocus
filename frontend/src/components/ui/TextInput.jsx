import { useId } from 'react';
import { CircleAlert } from 'lucide-react';
import './TextInput.css';

/**
 * Field frame shared by TextInput and TextArea (C13.1a): a visible label,
 * an optional hint, the control, and an error line with an alert icon.
 * The error line is always mounted and polite, so a new error is read out
 * without moving focus; hint and error describe the control.
 */
export function Field({ id, label, hint, error, className = '', children }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const describedBy = [hintId, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`rf-field ${error ? 'rf-field--error' : ''} ${className}`}>
      <label className="rf-field__label" htmlFor={id}>{label}</label>
      {hint && <p id={hintId} className="rf-field__hint">{hint}</p>}
      {children({ 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      <p id={errorId} className="rf-field__error" aria-live="polite">
        {error && (
          <>
            <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>{error}</span>
          </>
        )}
      </p>
    </div>
  );
}

/** Text input from the components sheet: radius 8, field border (A1), accent focus ring, warn error. */
export function TextInput({ id, label, hint, error, className, type = 'text', ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} className={className}>
      {(aria) => <input id={inputId} type={type} className="rf-input" {...aria} {...props} />}
    </Field>
  );
}
