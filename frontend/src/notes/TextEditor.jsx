import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Bold, Italic, List, ListChecks, ListOrdered, Sigma, SquareSigma } from 'lucide-react';
import { BlockMath, InlineMath } from './mathNodes';
import './TextEditor.css';

// Only what the server's allow-list keeps (backend/services/note_content.py): no headings, code blocks, rules,
// links or underline; checklists and math added.
const EXTENSIONS = [
  StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false, link: false, underline: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'Write about this passage… $x$ for math' }),
  InlineMath,
  BlockMath,
];

const BUTTONS = [
  { name: 'Bold', key: 'Ctrl+B', Icon: Bold, active: 'bold', run: (c) => c.toggleBold() },
  { name: 'Italic', key: 'Ctrl+I', Icon: Italic, active: 'italic', run: (c) => c.toggleItalic() },
  { name: 'Bulleted list', Icon: List, active: 'bulletList', run: (c) => c.toggleBulletList() },
  { name: 'Numbered list', Icon: ListOrdered, active: 'orderedList', run: (c) => c.toggleOrderedList() },
  { name: 'Checklist', Icon: ListChecks, active: 'taskList', run: (c) => c.toggleTaskList() },
  { name: 'Inline math', key: '$…$', Icon: Sigma, run: (c) => c.insertInlineMath() },
  { name: 'Display math', key: '$$…$$', Icon: SquareSigma, run: (c) => c.insertBlockMath() },
];

/**
 * A text note's editor (C22.2b), loaded only when a note is edited: TipTap with bold, italic, lists, checklists
 * and math ($…$ inline, $$…$$ display, KaTeX). Every change goes to `onChange` as TipTap JSON (autosaved by
 * useNotes); Escape (or Done, in the note's header) returns to the drawn note. The format bar is one tab stop
 * (arrows move along it).
 */
export default function TextEditor({ content, label, onChange, onDone }) {
  const changed = useRef(onChange);
  useEffect(() => { changed.current = onChange; }, [onChange]); // a new note's id arrives after its editor opens
  const editor = useEditor({
    extensions: EXTENSIONS,
    content,
    autofocus: 'end',
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'rf-editor-text', 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' } },
    onUpdate: ({ editor: e }) => changed.current(e.getJSON()),
  });
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => Object.fromEntries(BUTTONS.filter((b) => b.active).map((b) => [b.active, e?.isActive(b.active) ?? false])),
  });

  const onBarKey = (event) => {
    const items = [...event.currentTarget.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[event.key];
    if (to === undefined || i < 0) return;
    event.preventDefault();
    items[(to + items.length) % items.length].focus();
  };

  return (
    <div className="rf-editor" onKeyDown={(event) => {
      // The LaTeX field stops its own Escape (mathNodes.js); any other closes the editor, not the panel.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDone(); }
    }}>
      <div className="rf-editor-bar" role="toolbar" aria-label="Format" onKeyDown={onBarKey}>
        {BUTTONS.map(({ name, key, Icon, active: mark, run }, i) => (
          <button key={name} type="button" className="rf-editor-tool" tabIndex={i === 0 ? 0 : -1}
            aria-label={key ? `${name} (${key})` : name} aria-pressed={mark ? Boolean(active?.[mark]) : undefined}
            title={key ? `${name} · ${key}` : name}
            onMouseDown={(event) => event.preventDefault()} onClick={() => run(editor.chain().focus()).run()}>
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
