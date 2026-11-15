import { ArrowLeft, List, MessageSquareText, NotebookPen } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';
import { SIZES } from './textSize';
import './ReaderToolbar.css';

/**
 * The reader's toolbar (handoff, screen 06): back to the library, book and
 * chapter, smaller and larger text, theme, and the session's own controls
 * passed in as children. A floating pill that fades and lifts 8 px while
 * the reader reads; focus inside keeps it shown, so it is always reachable
 * by keyboard. Icons only on narrow screens. `onSteve` adds Steve's button (C20.7b). Without `onSize` the text-size pair
 * is left out and `controls` (the original view's, C17.4) take its place.
 */
export function ReaderToolbar({
  bookTitle, chapter, size, onSize, onBack, visible, onFocusChange, onContents, contentsOpen, contentsRef,
  lookupOn, onLookupToggle, controls, onNotes, notesOpen, notesRef, notesCount, onSteve, steveOpen, steveRef, onFocusMode, children,
}) {
  const index = SIZES.indexOf(size);
  return (
    <div
      className="rf-toolbar"
      role="toolbar"
      aria-label="Reading controls"
      data-visible={visible}
      onFocus={() => onFocusChange(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange(false); }}
    >
      <button type="button" className="rf-tool" onClick={onBack} aria-label="Back to the library">
        <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        <span className="rf-tool-label">Library</span>
      </button>
      <span className="rf-toolbar-rule" aria-hidden="true" />
      <p className="rf-toolbar-title">
        {[bookTitle, chapter].filter(Boolean).join(' · ')}
      </p>
      <span className="rf-toolbar-rule" aria-hidden="true" />
      {onSize && (
        <>
          <div className="rf-toolbar-group" role="group" aria-label="Text size">
            <button type="button" className="rf-tool rf-size rf-size--small" onClick={() => onSize(-1)} disabled={index <= 0}
              aria-label="Smaller text">A</button>
            <button type="button" className="rf-tool rf-size rf-size--large" onClick={() => onSize(1)} disabled={index >= SIZES.length - 1}
              aria-label="Larger text">A</button>
          </div>
          <span className="rf-toolbar-rule" aria-hidden="true" />
        </>
      )}
      {controls && (
        <>
          {controls}
          <span className="rf-toolbar-rule" aria-hidden="true" />
        </>
      )}
      {onContents && (
        <button type="button" className="rf-tool" ref={contentsRef} onClick={onContents}
          aria-haspopup="dialog" aria-expanded={contentsOpen} aria-label="Contents">
          <List size={18} strokeWidth={1.75} aria-hidden="true" />
          <span className="rf-tool-label">Contents</span>
        </button>
      )}
      {onLookupToggle && (
        // Handoff: a "Look up" switch. Off stops hover lookup; a selection with Enter or ? still works.
        <button type="button" role="switch" aria-checked={lookupOn} className="rf-tool rf-switch"
          onClick={onLookupToggle} aria-label="Look up words on hover">
          <span className="rf-tool-label" aria-hidden="true">Look up</span>
          <span className="rf-switch-track" aria-hidden="true"><span className="rf-switch-knob" /></span>
        </button>
      )}
      {onNotes && (
        // C22.2: the notepad, in the side panel beside the book, with its count (handoff screen 19).
        <button type="button" className="rf-tool" ref={notesRef} onClick={onNotes} aria-expanded={notesOpen}
          aria-controls={notesOpen ? 'rf-side-panel' : undefined} aria-label={notesCount ? `Notes, ${notesCount}` : 'Notes'}>
          <NotebookPen size={18} strokeWidth={1.75} aria-hidden="true" />
          <span className="rf-tool-label">Notes</span>
          {notesCount > 0 && <span className="rf-tool-count" aria-hidden="true">{notesCount}</span>}
        </button>
      )}
      {onSteve && (
        // C20.7b: Steve's tab of the side panel; pressed while it is open.
        <button type="button" className="rf-tool" ref={steveRef} onClick={onSteve} aria-expanded={steveOpen}
          aria-controls={steveOpen ? 'rf-side-panel' : undefined} aria-label="Ask Steve">
          <MessageSquareText size={18} strokeWidth={1.75} aria-hidden="true" />
          <span className="rf-tool-label">Steve</span>
        </button>
      )}
      {onFocusMode && (
        // C23.6: focus mode's switch; the focus bar takes the toolbar's place while it is on.
        <button type="button" role="switch" aria-checked={false} className="rf-tool rf-switch" onClick={onFocusMode}
          aria-label="Focus mode">
          <span className="rf-tool-label" aria-hidden="true">Focus</span>
          <span className="rf-switch-track" aria-hidden="true"><span className="rf-switch-knob" /></span>
        </button>
      )}
      <ThemeToggle />
      {children && <span className="rf-toolbar-rule" aria-hidden="true" />}
      {children}
    </div>
  );
}
