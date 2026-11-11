import { useId } from 'react';
import { Field } from './TextInput';

/** Text area for written answers: the TextInput field frame, resizable vertically, Lora for the reader's own words. */
export function TextArea({ id, label, hint, error, className, rows = 4, ...props }) {
  const autoId = useId();
  const areaId = id || autoId;
  return (
    <Field id={areaId} label={label} hint={hint} error={error} className={className}>
      {(aria) => <textarea id={areaId} rows={rows} className="rf-input rf-input--area" {...aria} {...props} />}
    </Field>
  );
}
