import { useId } from 'react';
import { SteveMath } from '../steve/SteveMath';

/** A note's picture from the notes bucket (a signed URL the list gave, or the one from the upload just made). */
function NoteImage({ note, alt }) {
  const url = note.content?.image_path ? note.urls?.[note.content.image_path] : null;
  if (!url) return null;
  return <img className="rf-note-img" src={url} alt={alt} width={480} height={270} loading="lazy" decoding="async" />;
}

/** A labelled text field inside a note: saves through onChange as the reader types (autosave, 800 ms). */
function Field({ label, value, onChange, mono = false, rows = 2 }) {
  const id = useId();
  return (
    <div className="rf-note-field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} value={value ?? ''} rows={rows} spellCheck={!mono} data-mono={mono || undefined}
        onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/**
 * Equation, code and figure notes (C22.6, D2), made from the book: an equation shows its crop and its LaTeX
 * rendered with KaTeX above the editable source; code its language and its exact text; a figure its crop and an
 * editable caption. `reference` names the passage ("p. 4") for the picture's alt text.
 */
export function BlockNote({ note, reference, onChange }) {
  const content = note.content ?? {};
  const set = (field) => (value) => onChange({ content: { ...content, [field]: value } });
  if (note.kind === 'equation') {
    return (
      <div className="rf-note-block">
        <NoteImage note={note} alt={`Equation at ${reference}, as printed`} />
        {content.latex && <div className="rf-note-math"><SteveMath tex={content.latex} display /></div>}
        <Field label="LaTeX" value={content.latex} onChange={set('latex')} mono />
      </div>
    );
  }
  if (note.kind === 'code') {
    return (
      <div className="rf-note-block">
        {content.language && <p className="rf-note-lang">{content.language}</p>}
        <Field label="Code" value={content.code} onChange={set('code')} mono rows={Math.min(14, Math.max(3, (content.code ?? '').split('\n').length))} />
      </div>
    );
  }
  return (
    <div className="rf-note-block">
      <NoteImage note={note} alt={content.caption || `Figure at ${reference}`} />
      <Field label="Caption" value={content.caption} onChange={set('caption')} />
    </div>
  );
}
