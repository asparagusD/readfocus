import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from '@floating-ui/react';
import { Check } from 'lucide-react';
import { cleanComment, COMMENT_MAX } from './palette';
import './SelectionToolbar.css';

/**
 * Edge's Add comment (C39.8, issue 23, D1): a small panel under a highlight (or the selection it will highlight) with
 * the comment in plain text. ✓ (or Ctrl+Enter) saves it (`onSave(text | null)`: an emptied comment is none), Cancel or
 * Escape leaves it as it was, Delete comment (an existing one) saves none. `at()` is the rect it hangs from, read
 * whenever it moves. The text box takes focus; `onClose(toBook)` gives focus back.
 */
export function CommentEditor({ at, initial = '', existing = false, onSave, onClose }) {
  const [text, setText] = useState(initial);
  const field = useRef(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-start', strategy: 'fixed', transform: false,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })], whileElementsMounted: autoUpdate,
  });
  useLayoutEffect(() => { refs.setPositionReference({ getBoundingClientRect: () => at() ?? new DOMRect() }); }, [refs, at]);
  const setFloating = useCallback((el) => { // focus the text as soon as the portal has mounted it, so no key is lost
    refs.setFloating(el);
    if (el) (field.current ?? el.querySelector('textarea'))?.focus({ preventScroll: true });
  }, [refs]);
  const save = (value) => { onSave(cleanComment(value)); onClose(true); };

  return (
    <FloatingPortal>
      <div ref={setFloating} className="rf-comment-editor" role="dialog" aria-label={existing ? 'Edit comment' : 'Add comment'}
        style={floatingStyles} onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(text); }
        }}>
        <textarea ref={field} className="rf-comment-field" aria-label="Comment" value={text} maxLength={COMMENT_MAX} rows={3}
          placeholder="Add a comment" onChange={(event) => setText(event.target.value)} />
        <div className="rf-comment-actions">
          {existing && (
            <button type="button" className="rf-comment-btn rf-comment-btn--quiet" onClick={() => save('')}>Delete comment</button>
          )}
          <span className="rf-comment-count" aria-hidden="true">{text.length > COMMENT_MAX - 100 ? `${text.length}/${COMMENT_MAX}` : ''}</span>
          <button type="button" className="rf-comment-btn" onClick={() => onClose(true)}>Cancel</button>
          <button type="button" className="rf-comment-btn rf-comment-btn--save" aria-label="Save comment" title="Save (Ctrl+Enter)"
            onClick={() => save(text)}>
            <Check size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </FloatingPortal>
  );
}
