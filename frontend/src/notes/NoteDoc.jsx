import { SteveMath } from '../steve/SteveMath';

const MARKS = { bold: 'strong', italic: 'em', strike: 's', code: 'code' };

function Inline({ node }) {
  if (node.type === 'text') {
    return (node.marks ?? []).reduce((inner, mark) => {
      const Tag = MARKS[mark.type];
      return Tag ? <Tag>{inner}</Tag> : inner;
    }, node.text);
  }
  if (node.type === 'hardBreak') return <br />;
  if (node.type === 'inlineMath') return <SteveMath tex={node.attrs?.latex ?? ''} />;
  return null;
}

function Block({ node }) {
  const children = (node.content ?? []).map((child, i) => <Node key={i} node={child} />);
  switch (node.type) {
    case 'paragraph': return <p>{children.length ? children : <br />}</p>;
    case 'bulletList': return <ul>{children}</ul>;
    case 'orderedList': return <ol start={node.attrs?.start ?? 1}>{children}</ol>;
    case 'listItem': return <li>{children}</li>;
    case 'taskList': return <ul className="rf-note-tasks">{children}</ul>;
    case 'taskItem': return (
      <li className="rf-note-task" data-checked={Boolean(node.attrs?.checked)}>
        <input type="checkbox" checked={Boolean(node.attrs?.checked)} readOnly tabIndex={-1} aria-label={node.attrs?.checked ? 'Done' : 'Not done'} />
        <div>{children}</div>
      </li>
    );
    case 'blockquote': return <blockquote>{children}</blockquote>;
    case 'blockMath': return <SteveMath tex={node.attrs?.latex ?? ''} display />;
    default: return null;
  }
}

function Node({ node }) {
  if (!node || typeof node !== 'object') return null;
  return ['text', 'hardBreak', 'inlineMath'].includes(node.type) ? <Inline node={node} /> : <Block node={node} />;
}

/**
 * A text note as the reader wrote it (C22.2): its TipTap JSON drawn as plain React, so showing the notepad loads
 * neither TipTap nor any HTML. Only the node and mark types the server allows (note_content.py) are drawn;
 * anything else is skipped. Math goes through KaTeX's MathML, loaded on the first equation (SteveMath).
 */
export function NoteDoc({ doc }) {
  const blocks = doc?.type === 'doc' ? doc.content ?? [] : [];
  if (!blocks.some((b) => b.content?.length || b.type === 'blockMath')) return <p className="rf-note-empty">Empty note</p>;
  return <div className="rf-note-doc">{blocks.map((b, i) => <Node key={i} node={b} />)}</div>;
}
