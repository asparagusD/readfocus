import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, exportToBlob, hashElementsVersion, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { drawingScene, paperView, passageLines } from './drawing';
import { dataUrlOf, keptFiles, libraryStore, pictureSize, shrinkImage } from './pageImages';
import { BREAK, facesFor, lineElements, TOP_LEFT } from './pageText';

// C37.6 (issue 26): Excalidraw's full tools but its AI (constraint 1): pictures (uploaded to the reader's notes
// folder, pageImages.js), the library (kept in this browser), frames, the laser and Mermaid, and a page saved as a
// PNG or SVG image. Saving or loading .excalidraw files and the page colour (the paper's) stay off.
const UI = {
  canvasActions: { export: false, loadScene: false, saveToActiveFile: false, saveAsImage: true, toggleTheme: null, changeViewBackgroundColor: false, clearCanvas: true },
  tools: { image: true },
};
const library = libraryStore();
const noEmbeds = () => false; // web embeds would load other hosts (and frame-src allows none)
const THUMB_SIDES = [480, 360, 240];
const THUMB_MAX = 250_000; // under the bucket's 256 KB

async function thumbnail(elements, files = null) {
  if (!elements.length) return null;
  for (const side of THUMB_SIDES) {
    const blob = await exportToBlob({ elements, files, mimeType: 'image/png', maxWidthOrHeight: side, exportPadding: 16,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false } });
    if (blob.size <= THUMB_MAX) return blob;
  }
  return null;
}

/**
 * A drawing note's editor (C22.3), loaded only when a drawing is opened: Excalidraw with its own shapes, arrows,
 * freehand, text, undo and redo, in our light or Lamplight (dark) theme; its AI is off, so nothing goes to another
 * model (C37.6: its other tools are on, see UI). Every change of the scene goes to `onChange` as { elements,
 * appState, files }; "Paste
 * passage" adds the note's passage as a text element. `register` hands the parent `finish()` (a PNG thumbnail of the
 * scene, or null), `paste()`, and C37.2 `idle()`: true when Escape has nothing left to do in Excalidraw (no text
 * being typed, no shape being drawn, the selection tool, no menu or dialog open), so the notebook may close on it.
 * `focus` false leaves the focus where it is (a page turned by the notebook's arrows or tabs). C37.3: `add(lines)`
 * puts notebookItems.js lines on the page as text elements, below what it holds (or at the top of the view on an
 * empty page), scrolls to them and saves the scene at once. C37.5: the canvas is transparent over the page's
 * `paper` (ruled, squared or plain), whose lines follow Excalidraw's scroll and zoom; every save keeps the paper.
 * C37.6: a picture put on the page is made small and handed to `onUpload(blob)` ({ path, url }); once it is in the
 * reader's folder the page keeps it as { path, mimeType }. On opening, the page's pictures are read back from their
 * signed `urls` (path to URL, as the notes list gives them).
 */
export default function DrawingEditor({ content, dark, passage, register, onChange, focus = true, paper = null, urls = {}, onUpload = null }) {
  const api = useRef(null);
  const [ready] = useState(() => { let open; const promise = new Promise((resolve) => { open = resolve; }); return { promise, open }; });
  const seen = useRef(null);
  const changed = useRef(onChange);
  useEffect(() => { changed.current = onChange; }, [onChange]);
  const kept = useRef(paper); // the page's paper, kept in every save
  useEffect(() => { kept.current = paper; }, [paper]);
  const box = useRef(null);
  // C37.6: the page's uploaded pictures (fileId to { path, mimeType }), those on their way, and those refused.
  const [stored] = useState(() => new Map(Object.entries(content?.files ?? {})));
  const pending = useRef(new Set());
  const uploader = useRef(onUpload);
  useEffect(() => { uploader.current = onUpload; }, [onUpload]);
  const scene = useCallback((elements) => drawingScene(elements, kept.current, keptFiles(elements, stored)), [stored]);

  /** A picture new on the page: made small, uploaded, then kept (the page saved again with it). */
  const upload = useCallback(async (id, file) => {
    pending.current.add(id);
    try {
      const blob = await shrinkImage(file.dataURL);
      if (!blob || !uploader.current) throw new Error('This picture could not be made small enough to keep.');
      const { path } = await uploader.current(blob);
      stored.set(id, { path, mimeType: blob.type });
      const elements = api.current?.getSceneElements() ?? [];
      if (elements.some((e) => e.fileId === id)) changed.current(scene(elements));
    } catch { /* not kept (onUpload says why); it stays on the page until it is closed */ }
  }, [stored, scene]);

  const onScene = useCallback((elements, appState, files) => {
    const view = paperView(appState); // the paper's lines follow the view, set straight on the box (no render)
    for (const [name, value] of Object.entries(view)) box.current?.style.setProperty(`--paper-${name}`, value);
    for (const [id, file] of Object.entries(files ?? {})) {
      if (!stored.has(id) && !pending.current.has(id) && file?.dataURL) upload(id, file);
    }
    const version = hashElementsVersion(elements);
    if (seen.current === null) { seen.current = version; ready.open(api.current); return; } // the scene as it opened: add() may go now
    if (version === seen.current) return;
    seen.current = version;
    changed.current(scene(elements));
  }, [ready, stored, upload, scene]);

  // C37.6: the page's pictures, read back from their signed URLs once Excalidraw is ready.
  const signed = useRef(urls);
  useEffect(() => {
    let live = true;
    ready.promise.then(async (editor) => {
      for (const [id, file] of stored) {
        const url = signed.current?.[file.path];
        const dataURL = url ? await dataUrlOf(url).catch(() => null) : null;
        if (live && dataURL) editor.addFiles([{ id, mimeType: file.mimeType, dataURL, created: Date.now() }]);
      }
    });
    return () => { live = false; };
  }, [ready, stored]);

  // The panel widens once the drawing is open (and a window can resize): Excalidraw keeps its canvas offsets
  // until told, so a stroke right after would land in the wrong place.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(() => api.current?.refresh());
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => register?.({
    refresh: () => api.current?.refresh(), // C37.7: the notebook has settled where it slid to
    idle: () => {
      const state = api.current?.getAppState();
      if (!state) return true;
      return !state.editingTextElement && !state.newElement && !state.multiElement && !state.openDialog
        && !state.openMenu && !state.openPopup && !state.openSidebar && !state.contextMenu && state.activeTool?.type === 'selection';
    },
    // C40.8 (DEBUG_LOG 2026-11-23): a dialog, menu or popup of Excalidraw's still open when Escape reaches the notebook
    // from outside it (its focus lost, as after Export to PNG on a slow machine) is closed here; true when one was.
    closeOverlay: () => {
      const state = api.current?.getAppState();
      if (!state || !(state.openDialog || state.openMenu || state.openPopup || state.contextMenu)) return false;
      api.current.updateScene({ appState: { openDialog: null, openMenu: null, openPopup: null, contextMenu: null } });
      return true;
    },
    add: async (lines) => {
      const editor = await ready.promise;
      await facesFor(lines.filter((l) => l.text));
      const before = editor.getSceneElements();
      const { scrollX, scrollY, zoom } = editor.getAppState();
      const x = before.length ? Math.min(...before.map((e) => e.x)) : -scrollX + TOP_LEFT.x / zoom.value;
      const y = before.length ? Math.max(...before.map((e) => e.y + e.height)) + BREAK : -scrollY + TOP_LEFT.y / zoom.value;
      // C37.6: a picture from the book is already in the reader's folder: kept by its path, shown from its data URL.
      const made = await lineElements(lines, { x, y }, async (image, at, top) => {
        const { width, height } = await pictureSize(image.dataURL).catch(() => ({ width: 0, height: 0 }));
        if (!width || !height) return null;
        const id = `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        stored.set(id, { path: image.path, mimeType: image.mimeType });
        editor.addFiles([{ id, mimeType: image.mimeType, dataURL: image.dataURL, created: Date.now() }]);
        return convertToExcalidrawElements([{ type: 'image', fileId: id, x: at, y: top, width, height }])[0];
      });
      if (!made.length) return;
      editor.updateScene({ elements: [...before, ...made], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      if (before.length) editor.scrollToContent(made, { fitToViewport: false }); // an empty page: already in view
      const all = editor.getSceneElements();
      seen.current = hashElementsVersion(all);
      changed.current(scene(all));
    },
    finish: () => thumbnail(drawingScene(api.current?.getSceneElements() ?? []).elements, api.current?.getFiles() ?? null),
    paste: () => {
      const editor = api.current;
      const lines = passageLines(passage);
      if (!editor || !lines) return;
      const { scrollX, scrollY, zoom } = editor.getAppState();
      const [text] = convertToExcalidrawElements([{ type: 'text', text: lines, fontSize: 16,
        x: -scrollX + 40 / zoom.value, y: -scrollY + 40 / zoom.value }]);
      editor.updateScene({ elements: [...editor.getSceneElements(), text], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    },
  }), [register, passage, ready, scene, stored]);

  return (
    <div className="rf-drawing-canvas" data-own-escape="true" data-paper={paper || undefined} ref={box}>
      {paper && <div className="rf-paper" aria-hidden="true" />}
      <Excalidraw
        excalidrawAPI={(made) => { api.current = made; }}
        initialData={{ elements: content?.elements ?? [], appState: { viewBackgroundColor: paper ? 'transparent' : '#ffffff' }, scrollToContent: true,
          libraryItems: library.load() }}
        onLibraryChange={library.save}
        validateEmbeddable={noEmbeds}
        theme={dark ? 'dark' : 'light'}
        aiEnabled={false}
        UIOptions={UI}
        onChange={onScene}
        autoFocus={focus}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ClearCanvas />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
