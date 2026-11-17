/**
 * Steve's answer as blocks (C20.7): the small Markdown the system rules ask for, read without any HTML.
 * Paragraphs, lists, fenced code with its language, display math ($$...$$), and inside text: inline math
 * ($...$), `code`, **bold**, *italic* and citations [p. 44] / [sec. 3] (only the labels that were sent become
 * chips). Pure: the panel turns the blocks into React elements, so nothing in an answer is ever parsed as HTML.
 * Works on a half-written answer while it streams: an unclosed fence or $$ is shown as it stands.
 */

const INLINE = /(\$[^$\n]+\$)|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[(?:p|sec)\. \d+(?:, (?:p|sec)\. \d+)*\])/g;

/** Inline segments of one line or paragraph: text, math, code, strong, em, cite. */
export function inline(text, labels = new Set()) {
  const out = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    const [whole, math, code, strong, em, cite] = match;
    if (math) out.push({ kind: 'math', tex: math.slice(1, -1) });
    else if (code) out.push({ kind: 'code', text: code.slice(1, -1) });
    else if (strong) out.push({ kind: 'strong', text: strong.slice(2, -2) });
    else if (em) out.push({ kind: 'em', text: em.slice(1, -1) });
    else if (cite) {
      const known = cite.slice(1, -1).split(', ').filter((label) => labels.has(label));
      if (known.length) known.forEach((label) => out.push({ kind: 'cite', label }));
      else if (labels.size === 0) out.push({ kind: 'text', text: whole }); // still streaming: shown as written
    }
    last = match.index + whole.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.filter((s) => s.kind !== 'text' || s.text);
}

const LIST_ITEM = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;

/** The answer's blocks. `labels`: the citation labels that may become chips (empty while streaming). */
export function toBlocks(markdown, labels = new Set()) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'para', segments: inline(para.join(' ').trim(), labels) });
    para = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
    if (fence) {
      flush();
      const code = [];
      let closed = false;
      for (i += 1; i < lines.length; i += 1) {
        if (/^\s*```\s*$/.test(lines[i])) { closed = true; break; }
        code.push(lines[i]);
      }
      if (!closed && code.at(-1) === '') code.pop(); // still streaming: the next line has not started
      blocks.push({ type: 'code', lang: fence[1].toLowerCase(), text: code.join('\n'), closed });
      continue;
    }
    if (line.trim().startsWith('$$')) {
      flush();
      const tex = [line.trim().slice(2)];
      let closed = tex[0].trimEnd().endsWith('$$') && tex[0].trim().length >= 2;
      if (closed) tex[0] = tex[0].trimEnd().slice(0, -2);
      while (!closed && i + 1 < lines.length) {
        i += 1;
        const next = lines[i];
        if (next.trimEnd().endsWith('$$')) { tex.push(next.trimEnd().slice(0, -2)); closed = true; } else tex.push(next);
      }
      blocks.push({ type: 'math', tex: tex.join('\n').trim(), closed });
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      flush();
      const ordered = Boolean(item[2]);
      const previous = blocks[blocks.length - 1];
      const segments = inline(item[3], labels);
      if (previous?.type === 'list' && previous.ordered === ordered && !previous.ended) previous.items.push(segments);
      else blocks.push({ type: 'list', ordered, start: ordered ? Number(item[2]) : 1, items: [segments] });
      continue;
    }
    if (!line.trim()) {
      flush();
      const previous = blocks[blocks.length - 1];
      if (previous?.type === 'list') previous.ended = true;
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks.map(({ ended, ...block }) => block); // eslint-disable-line no-unused-vars
}

/** The labels a finished answer's `done` event says were cited, as the set toBlocks wants. */
export function labelsOf(citations) {
  return new Set((citations ?? []).map((c) => c.label));
}

