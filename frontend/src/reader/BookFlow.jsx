import { memo } from 'react';

/** Text cut at mark boundaries; each piece wrapped in the em and strong marks covering it. */
function Marked({ text, marks }) {
  if (!marks?.length) return text;
  const cuts = [...new Set([0, text.length, ...marks.flatMap((m) => [m.start, m.end])])]
    .filter((n) => n >= 0 && n <= text.length)
    .sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, i) => {
    const end = cuts[i + 1];
    const kinds = new Set(marks.filter((m) => m.start <= start && m.end >= end).map((m) => m.kind));
    let piece = text.slice(start, end);
    if (kinds.has('strong')) piece = <strong>{piece}</strong>;
    if (kinds.has('em')) piece = <em>{piece}</em>;
    return <span key={start}>{piece}</span>;
  });
}

const BARE_CHAPTER = /^(chapter|book|part)\s+\S+\.?$|^[IVXLC]+\.?$/i;

/**
 * The session's blocks as book elements, in reading order. Each carries
 * data-b (its block id), which positions and later word lookup key on.
 * A chapter opens a new page; a bare "Chapter N" followed by a heading
 * becomes a label above the title. The first paragraph of a chapter gets
 * the drop cap and a small-caps first line.
 */
export const BookFlow = memo(function BookFlow({ blocks, lead = null }) {
  // A note set before the text on the first page (C12.5a): not a block, so no place points into it.
  const out = lead ? [<aside className="rf-note" key="lead">{lead}</aside>] : [];
  let opening = false; // the next paragraph opens a chapter
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const { id, type, text, marks } = block;
    if (type === 'chapter' && !block.continued) {
      const next = blocks[i + 1];
      const titled = next?.type === 'heading' && BARE_CHAPTER.test(text.trim());
      out.push(
        <header className="rf-chapter" key={id}>
          {titled && <p className="rf-chapter-label" data-b={id}>{text}</p>}
          <h2 className="rf-chapter-title" data-b={titled ? next.id : id}>{titled ? next.text : text}</h2>
        </header>,
      );
      if (titled) i += 1;
      opening = true;
      continue;
    }
    if (type === 'heading' || type === 'chapter') {
      out.push(<h3 className="rf-heading" data-b={id} key={id}><Marked text={text} marks={marks} /></h3>);
      continue;
    }
    const body = <Marked text={text} marks={marks} />;
    if (type === 'quote') {
      out.push(<blockquote className="rf-quote" key={id}><p data-b={id}>{body}</p></blockquote>);
    } else if (type === 'list_item') {
      out.push(<p className="rf-item" data-b={id} key={id}>{body}</p>);
    } else {
      const classes = ['rf-para'];
      if (opening && !block.continued) classes.push('drop-cap', 'rf-opening');
      if (block.continued) classes.push('rf-continued');
      out.push(<p className={classes.join(' ')} data-b={id} key={id}>{body}</p>);
    }
    opening = false;
  }
  return out;
});
