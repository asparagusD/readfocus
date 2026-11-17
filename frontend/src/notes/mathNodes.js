import { InputRule, Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { loadKatex, texToMathml } from '../steve/math';
import { BLOCK_MATH, INLINE_MATH } from './mathRules';

/**
 * Math in text notes (C22.2b; not @tiptap/extension-mathematics, whose KaTeX peer stops at 0.18): `inlineMath`
 * and `blockMath`, atoms with a `latex` attribute, drawn as KaTeX MathML (sanitised, steve/math.js). Typing
 * `$a^2$` makes inline math and `$$\sum k$$` display math. A click on an equation, or Enter while it is
 * selected, opens its LaTeX in a field: Enter or leaving it keeps the change, Escape drops it, and an emptied
 * equation is removed. JSON matches the server's allow-list (backend/services/note_content.py).
 */
function mathView(display) {
  return ({ node, getPos, editor }) => {
    const dom = document.createElement(display ? 'div' : 'span');
    dom.className = display ? 'rf-math-node rf-math-node--display' : 'rf-math-node';
    dom.contentEditable = 'false';
    const shown = document.createElement(display ? 'div' : 'span');
    shown.className = 'rf-math-shown';
    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'rf-math-field';
    field.setAttribute('aria-label', display ? 'Display equation in LaTeX' : 'Equation in LaTeX');
    field.hidden = true;
    dom.append(shown, field);
    let latex = node.attrs.latex;

    const draw = () => {
      shown.textContent = latex || 'Equation';
      shown.dataset.empty = latex ? 'false' : 'true';
      if (!latex) return;
      loadKatex().then((katex) => { shown.innerHTML = texToMathml(katex, latex, display); }).catch(() => {});
    };
    const close = (keep) => {
      if (field.hidden) return;
      field.hidden = true;
      shown.hidden = false;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      const value = keep ? field.value.trim() : latex;
      if (!value) {
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
        return;
      }
      editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { latex: value }); return true; })
        .setTextSelection(pos + node.nodeSize).focus().run();
    };
    const open = () => {
      field.value = latex;
      field.hidden = false;
      shown.hidden = true;
      field.focus();
      field.select();
    };
    dom.rfOpen = open;
    dom.addEventListener('click', (event) => { if (event.target !== field && editor.isEditable) open(); });
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); close(true); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(false); }
    });
    field.addEventListener('blur', () => close(true));
    draw();
    if (!latex) queueMicrotask(open); // inserted empty from the format bar: ask for its LaTeX at once

    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        node = next; // the view tracks the node it shows
        if (next.attrs.latex !== latex) { latex = next.attrs.latex; draw(); }
        return true;
      },
      selectNode: () => dom.classList.add('is-selected'),
      deselectNode: () => dom.classList.remove('is-selected'),
      stopEvent: (event) => event.target === field,
      ignoreMutation: () => true,
    };
  };
}

function mathNode({ name, display, find }) {
  return Node.create({
    name,
    group: display ? 'block' : 'inline',
    inline: !display,
    atom: true,
    selectable: true,
    addAttributes: () => ({ latex: { default: '' } }),
    parseHTML: () => [{ tag: `${display ? 'div' : 'span'}[data-math="${name}"]`, getAttrs: (el) => ({ latex: el.getAttribute('data-latex') ?? '' }) }],
    renderHTML: ({ node }) => [display ? 'div' : 'span', { 'data-math': name, 'data-latex': node.attrs.latex }, node.attrs.latex],
    addNodeView: () => mathView(display),
    addInputRules() {
      // The whole match, dollars included, becomes the equation (nodeInputRule would keep the text before the
      // capture group, leaving a stray "$"). A display equation typed alone in its paragraph takes its place.
      return [new InputRule({
        find,
        handler: ({ state, range, match }) => {
          const math = this.type.create({ latex: match[1].trim() });
          if (display) state.tr.replaceRangeWith(range.from, range.to, math);
          else state.tr.replaceWith(range.from, range.to, math);
        },
      })];
    },
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          const { selection } = editor.state;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== name) return false;
          editor.view.nodeDOM(selection.from)?.rfOpen?.();
          return true;
        },
      };
    },
    addCommands() {
      return {
        [display ? 'insertBlockMath' : 'insertInlineMath']: () => ({ commands }) => commands.insertContent({ type: name, attrs: { latex: '' } }),
      };
    },
  });
}

export const InlineMath = mathNode({ name: 'inlineMath', display: false, find: INLINE_MATH });
export const BlockMath = mathNode({ name: 'blockMath', display: true, find: BLOCK_MATH });
