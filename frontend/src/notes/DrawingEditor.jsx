import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, exportToBlob, hashElementsVersion, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { drawingScene, passageLines } from './drawing';
import { BREAK, facesFor, textElements, TOP_LEFT } from './pageText';

const UI = {
  canvasActions: { export: false, loadScene: false, saveToActiveFile: false, saveAsImage: false, toggleTheme: null, changeViewBackgroundColor: false, clearCanvas: true },
  tools: { image: false }, // no pictures: a scene holds only what the server keeps (note_content.py)
};
const THUMB_SIDES = [480, 360, 240];
const THUMB_MAX = 250_000; // under the bucket's 256 KB

async function thumbnail(elements) {
  if (!elements.length) return null;
  for (const side of THUMB_SIDES) {
    const blob = await exportToBlob({ elements, files: null, mimeType: 'image/png', maxWidthOrHeight: side, exportPadding: 16,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false } });
    if (blob.size <= THUMB_MAX) return blob;
  }
  return null;
}

/**
 * A drawing note's editor (C22.3), loaded only when a drawing is opened: Excalidraw with its own shapes, arrows,
 * freehand, text, undo and redo, in our light or Lamplight (dark) theme. Its AI, export, file and image tools are
 * off, so nothing leaves this app. Every change of the scene goes to `onChange` as { elements, appState }; "Paste
 * passage" adds the note's passage as a text element. `register` hands the parent `finish()` (a PNG thumbnail of the
 * scene, or null), `paste()`, and C37.2 `idle()`: true when Escape has nothing left to do in Excalidraw (no text
 * being typed, no shape being drawn, the selection tool, no menu or dialog open), so the notebook may close on it.
 * `focus` false leaves the focus where it is (a page turned by the notebook's arrows or tabs). C37.3: `add(lines)`
 * puts notebookItems.js lines on the page as text elements, below what it holds (or at the top of the view on an
 * empty page), scrolls to them and saves the scene at once.
 */
export default function DrawingEditor({ content, dark, passage, register, onChange, focus = true }) {
  const api = useRef(null);
  const [ready] = useState(() => { let open; const promise = new Promise((resolve) => { open = resolve; }); return { promise, open }; });
  const seen = useRef(null);
  const changed = useRef(onChange);
  useEffect(() => { changed.current = onChange; }, [onChange]);

  const onScene = useCallback((elements) => {
    const version = hashElementsVersion(elements);
    if (seen.current === null) { seen.current = version; ready.open(api.current); return; } // the scene as it opened: add() may go now
    if (version === seen.current) return;
    seen.current = version;
    changed.current(drawingScene(elements));
  }, [ready]);

  // The panel widens once the drawing is open (and a window can resize): Excalidraw keeps its canvas offsets
  // until told, so a stroke right after would land in the wrong place.
  const box = useRef(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(() => api.current?.refresh());
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => register?.({
    idle: () => {
      const state = api.current?.getAppState();
      if (!state) return true;
      return !state.editingTextElement && !state.newElement && !state.multiElement && !state.openDialog
        && !state.openMenu && !state.openPopup && !state.openSidebar && !state.contextMenu && state.activeTool?.type === 'selection';
    },
    add: async (lines) => {
      const editor = await ready.promise;
      await facesFor(lines);
      const before = editor.getSceneElements();
      const { scrollX, scrollY, zoom } = editor.getAppState();
      const x = before.length ? Math.min(...before.map((e) => e.x)) : -scrollX + TOP_LEFT.x / zoom.value;
      const y = before.length ? Math.max(...before.map((e) => e.y + e.height)) + BREAK : -scrollY + TOP_LEFT.y / zoom.value;
      const made = textElements(lines, { x, y });
      if (!made.length) return;
      editor.updateScene({ elements: [...before, ...made], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      if (before.length) editor.scrollToContent(made, { fitToViewport: false }); // an empty page: already in view
      const all = editor.getSceneElements();
      seen.current = hashElementsVersion(all);
      changed.current(drawingScene(all));
    },
    finish: () => thumbnail(drawingScene(api.current?.getSceneElements() ?? []).elements),
    paste: () => {
      const editor = api.current;
      const lines = passageLines(passage);
      if (!editor || !lines) return;
      const { scrollX, scrollY, zoom } = editor.getAppState();
      const [text] = convertToExcalidrawElements([{ type: 'text', text: lines, fontSize: 16,
        x: -scrollX + 40 / zoom.value, y: -scrollY + 40 / zoom.value }]);
      editor.updateScene({ elements: [...editor.getSceneElements(), text], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    },
  }), [register, passage, ready]);

  return (
    <div className="rf-drawing-canvas" data-own-escape="true" ref={box}>
      <Excalidraw
        excalidrawAPI={(made) => { api.current = made; }}
        initialData={{ elements: content?.elements ?? [], appState: { viewBackgroundColor: '#ffffff' }, scrollToContent: true }}
        theme={dark ? 'dark' : 'light'}
        aiEnabled={false}
        UIOptions={UI}
        onChange={onScene}
        autoFocus={focus}
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
