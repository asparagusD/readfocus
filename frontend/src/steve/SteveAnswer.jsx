import { Fragment, useMemo } from 'react';
import { labelsOf, toBlocks } from './answer';
import { tokenize } from './highlight';
import { SteveMath } from './SteveMath';

function Segments({ segments, citations, onCite }) {
  return segments.map((s, i) => {
    switch (s.kind) {
      case 'math': return <SteveMath key={i} tex={s.tex} />;
      case 'code': return <code key={i} className="rf-steve-inline-code">{s.text}</code>;
      case 'strong': return <strong key={i}>{s.text}</strong>;
      case 'em': return <em key={i}>{s.text}</em>;
      case 'cite': {
        const anchor = citations.find((c) => c.label === s.label)?.anchor;
        return (
          <button key={i} type="button" className="rf-steve-cite" onClick={() => anchor && onCite(anchor, s.label)}
            aria-label={`Go to ${s.label.replace('p.', 'page').replace('sec.', 'section')}`}>
            {s.label}
          </button>
        );
      }
      default: return <Fragment key={i}>{s.text}</Fragment>;
    }
  });
}

function Code({ lang, text }) {
  const tokens = useMemo(() => tokenize(text, lang), [text, lang]);
  return (
    <figure className="rf-steve-code">
      {lang && <figcaption className="rf-steve-code-lang">{lang}</figcaption>}
      <pre tabIndex={0}><code>{tokens.map((t, i) => (t.kind ? <span key={i} className={`rf-tok-${t.kind}`}>{t.text}</span> : <Fragment key={i}>{t.text}</Fragment>))}</code></pre>
    </figure>
  );
}

/**
 * One answer from Steve (C20.7b, handoff screen 15): its blocks as React elements, never HTML. While it
 * streams, citations show as written; once done, only the labels the server checked become chips that move the
 * book to their page or section without closing the panel. A caret marks the end while Steve writes.
 */
export function SteveAnswer({ text, citations = [], streaming = false, onCite }) {
  const blocks = useMemo(() => toBlocks(text, streaming ? new Set() : labelsOf(citations)), [text, citations, streaming]);
  const caret = streaming ? <span className="rf-steve-caret" aria-hidden="true" /> : null;
  return (
    <div className="rf-steve-answer">
      {blocks.map((block, i) => {
        const end = i === blocks.length - 1 ? caret : null;
        if (block.type === 'code') return <Fragment key={i}><Code lang={block.lang} text={block.text} />{end}</Fragment>;
        if (block.type === 'math') return <Fragment key={i}><SteveMath tex={block.tex} display />{end}</Fragment>;
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List key={i} start={block.ordered ? block.start : undefined}>
              {block.items.map((item, j) => (
                <li key={j}><Segments segments={item} citations={citations} onCite={onCite} />{j === block.items.length - 1 ? end : null}</li>
              ))}
            </List>
          );
        }
        return <p key={i}><Segments segments={block.segments} citations={citations} onCite={onCite} />{end}</p>;
      })}
      {!blocks.length && caret && <p>{caret}</p>}
    </div>
  );
}
