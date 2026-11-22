/**
 * An EPUB's marks as Markdown (C40.4d, issue 24, D2): an EPUB reflows, so its copy is the reader's highlights and
 * underlines with their comments, chapter by chapter in reading order, not the book. Pure, so it runs under node --test.
 */
import { colourName } from '../annotations/palette.js';

/** An EPUB annotation's chapter: the last contents entry at or before its section (A4: section * 1e6 + character). */
export function chapterFor(toc, annotation) {
  const index = Math.floor((annotation.position_start ?? 0) / 1e6);
  let found = null;
  for (const entry of toc ?? []) {
    const at = entry.loc?.index;
    if (at !== undefined && at <= index && (!found || at >= found.loc.index)) found = entry;
  }
  return found?.title ?? null;
}

const quote = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=\S)/).join('\n> ');
const plain = (text) => String(text ?? '').replace(/\r\n?/g, '\n').trim();

/**
 * The Markdown for `annotations` (ANCHORS A1 rows: style, color, anchors, comment, position_start), in reading order.
 * `chapterOf(annotation)` names its chapter (or null), `pageOf(annotation)` its page label ("p. 34", or '').
 */
export function marksMarkdown({ title, annotations, chapterOf = () => null, pageOf = () => '', date = new Date() }) {
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [`# ${title || 'Book'}: my highlights`, '', `From ReadFocus, ${day}.`];
  const marks = [...(annotations ?? [])]
    .filter((a) => a.anchors?.some((x) => x?.text?.trim()) || a.text_snapshot?.trim())
    .sort((a, b) => (a.position_start ?? 0) - (b.position_start ?? 0));
  if (!marks.length) return [...lines, '', 'No highlights yet.', ''].join('\n');
  let chapter;
  for (const mark of marks) {
    const here = chapterOf(mark) ?? null;
    if (here !== chapter) {
      chapter = here;
      lines.push('', `## ${here ?? 'Before the first chapter'}`);
    }
    const text = mark.anchors?.map((x) => x?.text).filter(Boolean).join(' ') || mark.text_snapshot;
    const kind = mark.style === 'underline' ? 'Underline' : 'Highlight';
    const where = [`${kind} (${colourName(mark.color ?? 'honey')})`, pageOf(mark)].filter(Boolean).join(' · ');
    lines.push('', `> ${quote(text)}`, '', where);
    const comment = plain(mark.comment);
    if (comment) lines.push('', ...comment.split('\n').map((line, i) => (i ? line : `**Comment:** ${line}`)));
  }
  return [...lines, ''].join('\n');
}
