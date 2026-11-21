import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Ellipsis, List, Maximize, MessageSquareText, Minimize, NotebookPen, Pin, PinOff } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';
import { SIZES } from './textSize';
import { useMedia } from './useMedia';
import './ReaderToolbar.css';

/** The width a group's laid-out children take (those in the flow, not `skip`), with the gaps between them. */
function contentWidth(group, skip = null) {
  if (!group) return 0;
  const kids = [...group.children].filter((el) => el !== skip && el.offsetWidth > 0 && getComputedStyle(el).position !== 'absolute');
  const gap = parseFloat(getComputedStyle(group).columnGap) || 0;
  return kids.reduce((sum, el) => sum + el.offsetWidth, 0) + gap * Math.max(0, kids.length - 1);
}

/**
 * C38.7b: whether Look up, Steve, Focus and the session's tools fit in the bar on one row beside everything else,
 * measured (the book's title, its controls and the notes count all change what fits), not guessed from the width.
 * `reading` is their box; its width is kept from when it was last in the bar, so the answer does not flip once they
 * move into More tools.
 */
const SPARE = 40; // px kept free, so a notes count or a longer chapter name moves the tools before the bar wraps

function useFits(bar, reading) {
  const [fits, setFits] = useState(true);
  const width = useRef(0);
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const measure = () => {
      const [start, middle, end] = ['.rf-toolbar-start', '.rf-toolbar-middle', '.rf-toolbar-end'].map((s) => el.querySelector(s));
      const inBar = reading.current?.parentElement === end; // not in More tools, which sits inside the end group
      if (inBar) width.current = reading.current.offsetWidth;
      const style = getComputedStyle(el);
      const gap = parseFloat(style.columnGap) || 0;
      const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2 * gap;
      const endGap = parseFloat(getComputedStyle(end).columnGap) || 0;
      const need = contentWidth(start) + contentWidth(middle) + contentWidth(end, inBar ? reading.current : null) + width.current + endGap;
      setFits(need + SPARE <= room);
    };
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    for (const group of el.children) watch.observe(group);
    return () => watch.disconnect();
  }, [bar, reading]);
  return fits;
}

/** Full screen for the whole page (C38.4b): whether it is on, kept current, and a toggle; null where it is not allowed. */
function useFullScreen() {
  const [on, setOn] = useState(() => Boolean(globalThis.document?.fullscreenElement));
  useEffect(() => {
    const change = () => setOn(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  if (!globalThis.document?.fullscreenEnabled) return null;
  const toggle = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
    .catch(() => {}); // refused (no user gesture, a policy): nothing changes
  return { on, toggle };
}

/**
 * The reader's toolbar (handoff, screen 06; C38.4b, issue 22: laid out as Edge's PDF toolbar). Edge's three groups:
 * back to the library, the book and chapter, and Contents on the left; the book's own controls (`controls`: zoom, page
 * box and Page view for a PDF, text settings for an EPUB, ReaderControls) in the middle; ReadFocus's tools on the
 * right: Notes, Look up, Steve, Focus and the session's own controls (children, e.g. Quiz me), then "More tools", a
 * panel under the bar (Escape or a press outside closes it) with the theme, pin and full screen; below 1280 px Look up,
 * Steve, Focus and the session's controls go into it too, and below 640 px the book's controls take a row of their
 * own. Pinned (`pinned`, `onPin`; the default) it stays shown; unpinned it fades and lifts 8 px while the reader reads
 * (`visible`), and focus inside keeps it shown, so it is always reachable by keyboard. Without `onSize` the
 * text-size pair is left out and `controls` (the original view's, C17.4) take its place. `onSteve` adds Steve (C20.7b).
 * C38.6a: `contentsDocked`: Contents opens a pane beside the pages, not a dialog. C38.7b: Look up, Steve, Focus and the
 * session's tools sit in the bar only when they fit on one row (useFits), else in More tools (was: from 1280 px).
 */
export function ReaderToolbar({
  bookTitle, chapter, size, onSize, onBack, visible, onFocusChange, onContents, contentsOpen, contentsRef,
  lookupOn, onLookupToggle, controls, onNotes, notesOpen, notesRef, notesCount, onSteve, steveOpen, steveRef, onFocusMode,
  pinned = false, onPin = null, contentsDocked = false, children,
}) {
  const index = SIZES.indexOf(size);
  const full = useFullScreen();
  const bar = useRef(null);
  const readingBox = useRef(null);
  const fits = useFits(bar, readingBox);
  const roomy = useMedia('(min-width: 640px)') && fits; // room in the bar for Look up, Steve, Focus and the session's tools
  const [more, setMore] = useState(false);
  const moreButton = useRef(null);
  const panel = useRef(null);
  useEffect(() => {
    if (!more) return undefined;
    const away = (event) => {
      if (!panel.current?.contains(event.target) && !moreButton.current?.contains(event.target)) setMore(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [more]);
  const onPanelKey = (event) => { // Escape anywhere in the bar (the More button too) closes the panel
    if (!more || event.key !== 'Escape') return;
    event.stopPropagation();
    setMore(false);
    moreButton.current?.focus();
  };

  // Look up, Steve, Focus and the session's own controls: in the bar when there is room, else in More tools.
  const reading = (
    <div className="rf-toolbar-reading" ref={readingBox}>
      {onLookupToggle && (
        // Handoff: a "Look up" switch. Off stops hover lookup; a selection with Enter or ? still works.
        <button type="button" role="switch" aria-checked={lookupOn} className="rf-tool rf-switch"
          onClick={onLookupToggle} aria-label="Look up words on hover">
          <span className="rf-tool-label" aria-hidden="true">Look up</span>
          <span className="rf-switch-track" aria-hidden="true"><span className="rf-switch-knob" /></span>
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
      {children}
    </div>
  );

  return (
    <div
      ref={bar}
      className="rf-toolbar"
      role="toolbar"
      aria-label="Reading controls"
      data-visible={visible}
      data-pinned={pinned || undefined}
      onKeyDown={onPanelKey}
      onFocus={() => onFocusChange(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange(false); }}
    >
      <div className="rf-toolbar-start">
        <button type="button" className="rf-tool" onClick={onBack} aria-label="Back to the library">
          <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          <span className="rf-tool-label">Library</span>
        </button>
        <span className="rf-toolbar-rule" aria-hidden="true" />
        <p className="rf-toolbar-title">
          {[bookTitle, chapter].filter(Boolean).join(' · ')}
        </p>
        {onContents && (
          <button type="button" className="rf-tool" ref={contentsRef} onClick={onContents}
            aria-haspopup={contentsDocked ? undefined : 'dialog'} aria-expanded={contentsOpen} aria-label="Contents">
            <List size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="rf-tool-label">Contents</span>
          </button>
        )}
      </div>

      <div className="rf-toolbar-middle">
        {onSize && (
          <div className="rf-toolbar-group" role="group" aria-label="Text size">
            <button type="button" className="rf-tool rf-size rf-size--small" onClick={() => onSize(-1)} disabled={index <= 0}
              aria-label="Smaller text">A</button>
            <button type="button" className="rf-tool rf-size rf-size--large" onClick={() => onSize(1)} disabled={index >= SIZES.length - 1}
              aria-label="Larger text">A</button>
          </div>
        )}
        {controls}
      </div>

      <div className="rf-toolbar-end">
        {onNotes && (
          // C22.2: the notes, with their count (handoff screen 19); since C37.3 the button opens the notebook.
          <button type="button" className="rf-tool" ref={notesRef} onClick={onNotes} aria-haspopup="dialog" aria-expanded={notesOpen}
            aria-controls={notesOpen ? 'rf-notebook' : undefined} aria-label={notesCount ? `Notes, ${notesCount}` : 'Notes'}>
            <NotebookPen size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="rf-tool-label">Notes</span>
            {notesCount > 0 && <span className="rf-tool-count" aria-hidden="true">{notesCount}</span>}
          </button>
        )}
        {roomy && reading}
        <button type="button" className="rf-tool rf-toolbar-more-button" ref={moreButton} onClick={() => setMore((open) => !open)}
          aria-expanded={more} aria-controls="rf-toolbar-more" aria-label="More tools">
          <Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div id="rf-toolbar-more" className="rf-toolbar-more" ref={panel} data-open={more || undefined}
          onClick={(event) => { // C38.7b: a tool used from the panel (not a switch or toggle) closes it; focus on More
            const tool = event.target.closest('button');
            if (!tool || tool.hasAttribute('aria-pressed') || tool.getAttribute('role') === 'switch') return;
            setMore(false);
            moreButton.current?.focus(); // a dialog the tool opens takes focus after this
          }}>
          {!roomy && reading}
          <ThemeToggle />
          {onPin && (
            <button type="button" className="rf-tool" onClick={onPin} aria-pressed={pinned}
              aria-label="Keep the toolbar shown" title={pinned ? 'Unpin: the toolbar fades while you read' : 'Pin: keep the toolbar shown'}>
              {pinned ? <Pin size={18} strokeWidth={1.75} aria-hidden="true" /> : <PinOff size={18} strokeWidth={1.75} aria-hidden="true" />}
              <span className="rf-tool-label">{pinned ? 'Pinned' : 'Pin'}</span>
            </button>
          )}
          {full && (
            <button type="button" className="rf-tool" onClick={full.toggle} aria-pressed={full.on} aria-label="Full screen"
              title={full.on ? 'Leave full screen' : 'Full screen'}>
              {full.on ? <Minimize size={18} strokeWidth={1.75} aria-hidden="true" /> : <Maximize size={18} strokeWidth={1.75} aria-hidden="true" />}
              <span className="rf-tool-label">Full screen</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
