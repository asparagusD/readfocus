/**
 * Drawing notes, without Excalidraw (C22.3): what of a scene is saved, and the passage as a text element's lines.
 * The server keeps elements, `appState.viewBackgroundColor` (and since C37.1 `paper`) and files in the reader's
 * folder (note_content.py); deleted elements are dropped. C37.5: a notebook page's paper is kept with its scene.
 * C37.6: pictures are kept too, with `files` ({ fileId: { path, mimeType } }, pageImages.keptFiles) for those
 * uploaded; without `files` (a scene with no pictures) none are sent.
 */
export function drawingScene(elements, paper = null, files = null) {
  return {
    elements: (elements ?? []).filter((e) => !e.isDeleted).map((e) => JSON.parse(JSON.stringify(e))),
    appState: { viewBackgroundColor: '#ffffff', ...(paper ? { paper } : {}) },
    ...(files && Object.keys(files).length ? { files } : {}),
  };
}

/** C37.5 (issue 26, D3): a page's paper; ruled for a new page, plain for a drawing made before pages had paper. */
export const PAPERS = ['ruled', 'squared', 'plain'];
export const pagePaper = (content) => (PAPERS.includes(content?.appState?.paper) ? content.appState.paper : 'plain');

/** A new notebook page's content: nothing on it yet, ruled paper. */
export const newPageContent = () => ({ elements: [], appState: { viewBackgroundColor: '#ffffff', paper: 'ruled' } });

/** The paper's grid in scene units: a rule (and a square) every RULE, the margin line at x = MARGIN. */
export const RULE = 32;
export const MARGIN = 40;

/**
 * Where the paper's lines fall on screen for Excalidraw's view (screen = (scene + scroll) * zoom), as CSS lengths.
 * Excalidraw's app state gives `zoom` as { value }.
 */
export function paperView({ scrollX = 0, scrollY = 0, zoom = { value: 1 } } = {}) {
  const scale = Number(zoom?.value ?? zoom) || 1;
  const step = RULE * scale;
  const wrap = (v) => ((v % step) + step) % step;
  return { step: `${step}px`, x: `${wrap(scrollX * scale)}px`, y: `${wrap(scrollY * scale)}px`, margin: `${(MARGIN + scrollX) * scale}px` };
}

/** The passage's words wrapped at about `width` characters a line, or '' when there is no text (whole pages). */
export function passageLines(passage, width = 36) {
  const words = (passage ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && (last + ' ' + word).length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.join('\n');
}

/** A note's passage: its anchors' text, in reading order. */
export const passageOf = (note) => (note.anchors ?? []).map((a) => a.text ?? '').filter(Boolean).join(' ');

/** A PNG blob as base64, for POST /books/{id}/note-files. */
export async function base64Of(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
